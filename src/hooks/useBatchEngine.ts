//! 批次引擎域：持有运行中批次与历史记录，驱动本地引擎的轮询 / 转存 / 短链 / 完成副作用。
//!
//! 这是应用的核心状态机。它拥有 `batches` / `histories` 两个状态切片及全部引擎 effect：
//! - 1.6s 轮询推进各批次队列项状态（`advanceLocalBatch`）；
//! - 转存 effect：对 `sharing` 项调 `transferProviderShare`，成功推进到 `creating_original`；
//! - 短链 effect：对 `creating_original` 项调 `createBackendLinks`，成功推进到 `done`；
//! - 完成 effect：全部 `done` 的批次转为成功历史并移出运行列表；
//! - 持久化 effect：批次去抖 2s 写 SQLite、历史变更即写。
//!
//! 跨域依赖（账号域 / toast 域 / 后台连接域 / 确认弹窗 / 路由）通过注入回调解耦。
//! 「何时对哪一项发起请求」的决策由 `batchReducer` 的纯谓词编码并单测覆盖。

import { useEffect, useRef, useState } from 'react';

import {
  createBackendLinks,
  deleteBatchFromDb,
  isTauriRuntime,
  loadBatchesFromDb,
  loadHistoryFromDb,
  saveBatchToDb,
  saveHistoryToDb,
  transferProviderShare,
} from '../lib/bridge';
import { isCredentialErrorMessage } from '../lib/guards';
import { formatBackendError } from '../lib/format';
import { providerLabels } from '../lib/constants';
import {
  advanceLocalBatch,
  createBatchLog,
  createQueueItemsFromDraft,
  formatNow,
  generateBatchId,
  normalizePlatformQueues,
} from '../lib/engine';
import {
  batchToHistory,
  deriveTransferSuccessUpdate,
  findItemToShortlink,
  findItemToTransfer,
  hasSamePlatformBlocker,
  isBatchComplete,
  reduceContinueBatch,
  reducePauseBatch,
  reduceQueueItemUpdate,
  reduceRetryBatch,
  reduceRetryQueueItem,
} from '../lib/batchReducer';
import { isBlockingStatus } from '../lib/guards';
import type { ToastState } from './useToast';
import type { BatchDraft, BatchLogEntry, BatchRecord, HistoryRecord } from '../lib/types';
import type { BatchMonitor, ProviderAccount, ProviderKey, QueueItem } from '../types';

/** 同一网盘平台两次转存发起之间的最小间隔（毫秒），用于规避平台限流；短链创建在此间隔内进行。 */
const TRANSFER_MIN_INTERVAL_MS = 4000;

/** 确认弹窗状态：标题 / 消息 / 确认按钮文案 / 是否危险 / 确认回调。 */
export type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

/** 批次引擎域 hook 的注入依赖。 */
export interface BatchEngineDeps {
  /** 当前网盘账号列表（转存 effect 据此查找队列项对应账号）。 */
  providerAccounts: ProviderAccount[];
  /** 后台 API Key（短链 effect 创建后台链接所需）。 */
  apiKey: string;
  /** 账号更新回调（转存遇到鉴权错误时把账号标记为 manual_required）。 */
  updateProviderAccount: (accountId: string, updater: (account: ProviderAccount) => ProviderAccount) => void;
  /** Toast 反馈回调。 */
  setToast: (toast: ToastState | null) => void;
  /** 打开确认弹窗（取消批次时请求用户确认）。 */
  requestConfirm: (state: ConfirmState) => void;
  /** 批次创建后的导航回调（跳转到状态页）。 */
  onBatchCreated: () => void;
  /** 本地乐观扣减短链用量（每次短链创建成功后调用，即时刷新余额显示）。 */
  deductQuotaLocally: (count: number) => void;
  /** 与线上同步短链额度（一批转存全部完成后调用）。 */
  syncQuotaFromBackend: () => Promise<void>;
}

/** 批次引擎域 hook 返回值。 */
export interface BatchEngine {
  batches: BatchRecord[];
  histories: HistoryRecord[];
  createBatch: (draft: BatchDraft) => void;
  pauseBatch: (batchId: string) => void;
  continueBatch: (batchId: string) => void;
  retryBatch: (batchId: string) => void;
  retryQueueItem: (batchId: string, itemId: string) => void;
  cancelBatch: (batchId: string) => void;
}

/**
 * 批次引擎域 hook。
 *
 * @param deps 跨域依赖（账号 / 后台连接 / toast / 确认弹窗 / 路由）
 */
export function useBatchEngine(deps: BatchEngineDeps): BatchEngine {
  const { providerAccounts, apiKey, updateProviderAccount, setToast, requestConfirm, onBatchCreated, deductQuotaLocally, syncQuotaFromBackend } = deps;

  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [histories, setHistories] = useState<HistoryRecord[]>([]);
  const backendRequestsRef = useRef(new Set<string>());
  // 按平台记录上次转存发起时间戳，用于强制两次转存间隔 ≥ TRANSFER_MIN_INTERVAL_MS（规避限流）。
  const lastTransferStartedAtRef = useRef<Record<ProviderKey, number>>({
    quark: 0,
    baidu: 0,
    xunlei: 0,
  });

  // 启动时从 SQLite 恢复批次与历史（刷新不丢）。
  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }
    void (async () => {
      try {
        const [savedBatches, savedHistory] = await Promise.all([loadBatchesFromDb(), loadHistoryFromDb()]);
        setBatches((current) => (current.length > 0 ? current : normalizePlatformQueues(savedBatches)));
        setHistories((current) => (current.length > 0 ? current : savedHistory));
      } catch (error) {
        console.warn('加载批次/历史失败', error);
      }
    })();
  }, []);

  // 批次变更时（去抖 2s）持久化到 SQLite，避免引擎 1.6s 轮询频繁写库。
  const batchSaveTimerRef = useRef<number | null>(null);
  const knownBatchIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }
    // 清理函数（return）会在每次 batches 变更前先 clear 上一轮定时器并置空 ref，
    // 因此这里无需再判空清理——直接设置新的去抖定时器即可。
    batchSaveTimerRef.current = window.setTimeout(() => {
      batchSaveTimerRef.current = null;
      const currentIds = new Set(batches.map((batch) => batch.id));
      void (async () => {
        try {
          for (const batch of batches) {
            await saveBatchToDb(batch);
          }
          for (const previousId of knownBatchIdsRef.current) {
            if (!currentIds.has(previousId)) {
              await deleteBatchFromDb(previousId);
            }
          }
          knownBatchIdsRef.current = currentIds;
        } catch (error) {
          console.warn('保存批次失败', error);
        }
      })();
    }, 2000);
    return () => {
      if (batchSaveTimerRef.current !== null) {
        window.clearTimeout(batchSaveTimerRef.current);
        batchSaveTimerRef.current = null;
      }
    };
  }, [batches]);

  // 历史变更时持久化到 SQLite。
  useEffect(() => {
    if (!isTauriRuntime() || histories.length === 0) {
      return undefined;
    }
    void (async () => {
      try {
        for (const history of histories) {
          await saveHistoryToDb(history);
        }
      } catch (error) {
        console.warn('保存历史失败', error);
      }
    })();
  }, [histories]);

  // 引擎轮询：每 1.6s 推进各批次队列项状态。
  useEffect(() => {
    const timer = window.setInterval(() => {
      setBatches((current) => normalizePlatformQueues(current.map((batch) => advanceLocalBatch(batch))));
    }, 1600);

    return () => window.clearInterval(timer);
  }, []);

  // === 内部更新工具 ===

  const updateBatch = (batchId: string, updater: (batch: BatchRecord) => BatchRecord) => {
    setBatches((current) => normalizePlatformQueues(current.map((batch) => (batch.id === batchId ? updater(batch) : batch))));
  };

  const updateQueueItem = (batchId: string, itemId: string, updater: (item: QueueItem) => QueueItem) => {
    updateBatch(batchId, (batch) => reduceQueueItemUpdate(batch, itemId, updater));
  };

  const appendBatchLog = (batchId: string, log: BatchLogEntry) => {
    setBatches((current) => current.map((batch) => (
      batch.id === batchId
        ? { ...batch, logs: [log, ...(batch.logs ?? [])].slice(0, 80), updatedAt: '刚刚' }
        : batch
    )));
  };

  // 转存 effect：对每个 running 批次中待转存项发起 transferProviderShare。
  // 强制同一平台两次转存发起间隔 ≥ TRANSFER_MIN_INTERVAL_MS 以规避限流；短链创建在此间隔内进行。
  useEffect(() => {
    const now = Date.now();
    batches.forEach((batch) => {
      if (!batch.localEngine || batch.status !== 'running') {
        return;
      }

      const item = findItemToTransfer(batch);
      if (!item) {
        return;
      }

      const requestKey = `transfer:${batch.id}:${item.id}`;
      if (backendRequestsRef.current.has(requestKey)) {
        return;
      }

      // 限流：距该平台上次转存发起不足 4s 则本轮跳过，等下一次轮询再试。
      const lastStartedAt = lastTransferStartedAtRef.current[batch.provider] ?? 0;
      if (now - lastStartedAt < TRANSFER_MIN_INTERVAL_MS) {
        // 仅在 step 文案未标记时限流时更新一次，避免每次轮询都触发额外渲染。
        if (item.step !== '转存排队中（限流间隔）') {
          updateQueueItem(batch.id, item.id, (currentItem) => ({
            ...currentItem,
            step: '转存排队中（限流间隔）',
          }));
        }
        return;
      }

      const account = providerAccounts.find((providerAccount) => providerAccount.id === item.accountId);
      lastTransferStartedAtRef.current[batch.provider] = now;
      backendRequestsRef.current.add(requestKey);
      appendBatchLog(batch.id, createBatchLog('info', '开始转存到我的网盘', item.title));
      void transferProviderShare({
        account,
        item,
        targetFolderRef: batch.targetFolderRef,
      })
        .then((result) => {
          appendBatchLog(batch.id, createBatchLog('success', `转存完成：${result.shareUrl}`, item.title));
          // 仅转存模式（无 API Key 或未绑定后台账号）：跳过后台登记，直接完成。
          // 有后台登记需求时才推进到 creating_original，由短链 effect 接管。
          const next = deriveTransferSuccessUpdate(batch, apiKey, result.shareUrl);
          updateQueueItem(batch.id, item.id, (currentItem) => ({ ...currentItem, ...next }));
        })
        .catch((error) => {
          const message = formatBackendError(error);
          console.error('[Ydisks Transfer] 转存失败', {
            batchId: batch.id,
            itemId: item.id,
            title: item.title,
            sourceUrl: item.sourceUrl,
            message,
          });
          appendBatchLog(batch.id, createBatchLog('danger', `转存失败：${message}`, item.title));
          const authError = isCredentialErrorMessage(message);
          if (authError && account) {
            updateProviderAccount(account.id, (current) => ({
              ...current,
              status: 'manual_required',
              pendingReason: message,
              lastChecked: '刚刚',
            }));
          }
          updateQueueItem(batch.id, item.id, (currentItem) => ({
            ...currentItem,
            error: message,
            progress: 45,
            status: authError ? 'manual_required' : 'waiting_retry',
            step: authError ? '等待人工处理' : '等待重试',
          }));
        })
        .finally(() => {
          backendRequestsRef.current.delete(requestKey);
        });
    });
    // updateProviderAccount 仅用稳定的 setProviderAccounts，无需入依赖（与原实现一致）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, providerAccounts]);

  // 短链 effect：对每个 running 批次中待登记项发起 createBackendLinks。
  useEffect(() => {
    batches.forEach((batch) => {
      if (!batch.localEngine || batch.status !== 'running') {
        return;
      }

      const item = findItemToShortlink(batch);
      if (!item) {
        return;
      }

      const requestKey = `${batch.id}:${item.id}`;
      if (backendRequestsRef.current.has(requestKey)) {
        return;
      }

      backendRequestsRef.current.add(requestKey);
      const hasShortLinkTargets = batch.shortLinkTargets.length > 0;
      appendBatchLog(
        batch.id,
        createBatchLog(
          'info',
          hasShortLinkTargets ? '开始登记后台原始链接并创建短链' : '开始登记后台原始链接',
          item.title,
        ),
      );
      updateQueueItem(batch.id, item.id, (currentItem) => ({
        ...currentItem,
        status: 'creating_shortlink',
        step: hasShortLinkTargets ? `当前处理：创建 ${batch.shortLinkTargets.length} 个渠道短链` : '当前处理：登记后台原始链接',
        progress: 85,
      }));

      void createBackendLinks({
        apiKey,
        item,
        targets: batch.shortLinkTargets,
        ydisksAccountId: batch.ydisksAccountId,
      })
        .then((result) => {
          appendBatchLog(
            batch.id,
            createBatchLog(
              'success',
              result.shortLinks.length > 0
                ? `后台创建完成：${result.shortLinks.length} 个短链`
                : '后台原始链接登记完成',
              item.title,
            ),
          );
          // 本地乐观扣减短链用量，使「剩余额度」即时下降；真实额度在批次完成后与线上同步。
          deductQuotaLocally(result.shortLinks.length);
          updateQueueItem(batch.id, item.id, (currentItem) => ({
            ...currentItem,
            error: undefined,
            originalLinkId: result.originalLinkId,
            progress: 100,
            shortLinks: result.shortLinks,
            shortUrl: result.shortLinks[0]?.shortUrl,
            status: 'done',
            step: result.shortLinks.length > 0 ? '短链创建完成' : '原始链接登记完成',
          }));
        })
        .catch((error) => {
          const message = formatBackendError(error);
          console.error('[Ydisks Transfer] 后台链接创建失败', {
            batchId: batch.id,
            itemId: item.id,
            title: item.title,
            shareUrl: item.shareUrl,
            message,
          });
          appendBatchLog(batch.id, createBatchLog('danger', `后台创建失败：${message}`, item.title));
          updateQueueItem(batch.id, item.id, (currentItem) => ({
            ...currentItem,
            error: message,
            progress: 70,
            status: 'waiting_retry',
            step: '等待重试',
          }));
        })
        .finally(() => {
          backendRequestsRef.current.delete(requestKey);
        });
    });
  }, [apiKey, batches]);

  // 完成 effect：全部 done 的批次转为成功历史并移出运行列表，随后与线上同步短链额度。
  useEffect(() => {
    const completed = batches.filter(isBatchComplete);

    if (completed.length === 0) {
      return;
    }

    const completedIds = new Set(completed.map((batch) => batch.id));
    setHistories((current) => [
      ...completed.map((batch) => batchToHistory(batch, 'success')),
      ...current,
    ]);
    setBatches((current) => normalizePlatformQueues(current.filter((batch) => !completedIds.has(batch.id))));
    // 一批转存全部完成后，与线上同步真实短链额度（修正本地乐观扣减的累计误差）。
    void syncQuotaFromBackend();
  }, [batches, syncQuotaFromBackend]);

  // === 公共操作 ===

  const createBatch = (draft: BatchDraft) => {
    const now = formatNow();
    const samePlatformBlocking = batches.some((batch) => batch.provider === draft.provider && isBlockingStatus(batch.status));
    const queuePosition = batches.filter((batch) => batch.provider === draft.provider && batch.status === 'queued').length + 1;
    const initialStatus: BatchMonitor['status'] = draft.executable === 0
      ? 'waiting_quota'
      : samePlatformBlocking
        ? 'queued'
        : 'running';

    const batch: BatchRecord = {
      id: generateBatchId(),
      status: initialStatus,
      provider: draft.provider,
      providerAccountName: draft.providerAccountName,
      ydisksAccountId: draft.ydisksAccountId,
      ydisksAccountName: draft.ydisksAccountName,
      targetFolderRef: draft.targetFolderRef,
      shortLinkTargetCount: draft.shortLinkTargets.length,
      total: draft.resources.length,
      completed: 0,
      currentIndex: draft.executable > 0 ? 1 : 0,
      queuePosition: initialStatus === 'queued' ? queuePosition : undefined,
      retrying: 0,
      waitingQuota: draft.waitingQuota,
      progress: 0,
      currentStep: initialStatus === 'queued'
        ? `同平台排队：等待${providerLabels[draft.provider]}当前批次完成`
        : initialStatus === 'waiting_quota'
          ? '等待短链额度'
          : '串行处理第 1 条',
      createdAt: now,
      updatedAt: '刚刚',
      localEngine: true,
      logs: [
        createBatchLog(
          initialStatus === 'queued' ? 'warning' : initialStatus === 'waiting_quota' ? 'warning' : 'info',
          initialStatus === 'queued'
            ? `同平台已有批次运行，${providerLabels[draft.provider]}任务进入队列`
            : initialStatus === 'waiting_quota'
              ? '短链额度不足，批次等待额度'
              : '批次已创建，开始串行处理',
        ),
      ],
      shortLinkTargets: draft.shortLinkTargets,
      items: [],
    };

    batch.items = createQueueItemsFromDraft(draft, batch.status);
    setBatches((current) => normalizePlatformQueues([batch, ...current]));
    onBatchCreated();
  };

  const pauseBatch = (batchId: string) => {
    updateBatch(batchId, reducePauseBatch);
  };

  const continueBatch = (batchId: string) => {
    setBatches((current) => {
      const target = current.find((batch) => batch.id === batchId);
      if (!target) {
        return current;
      }
      const hasPlatformBlocker = hasSamePlatformBlocker(current, batchId, target.provider);
      return normalizePlatformQueues(current.map((batch) => batch.id === batchId ? reduceContinueBatch(batch, hasPlatformBlocker) : batch));
    });
  };

  const retryBatch = (batchId: string) => {
    updateBatch(batchId, reduceRetryBatch);
  };

  const retryQueueItem = (batchId: string, itemId: string) => {
    updateBatch(batchId, (batch) => reduceRetryQueueItem(batch, itemId));
  };

  const cancelBatch = (batchId: string) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) {
      return;
    }
    requestConfirm({
      title: '取消批次',
      message: `确认取消当前批次？已完成 ${batch.completed}/${batch.total} 条，未完成项将标记为失败并转入历史记录。`,
      confirmLabel: '取消批次',
      danger: true,
      onConfirm: () => {
        setHistories((current) => [batchToHistory(batch, 'failed'), ...current]);
        setBatches((current) => normalizePlatformQueues(current.filter((item) => item.id !== batchId)));
        setToast({ message: '批次已取消', tone: 'info' });
      },
    });
  };

  return {
    batches,
    histories,
    createBatch,
    pauseBatch,
    continueBatch,
    retryBatch,
    retryQueueItem,
    cancelBatch,
  };
}
