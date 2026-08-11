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
  createBackendOriginalLink,
  createBackendShortLink,
  archiveBatchInDb,
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
  /** Rust 后台是否已保存 API Key；前端不持有密钥原值。 */
  hasBackendApiKey: boolean;
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
  /** 当前后台剩余短链额度，用于释放 waiting_quota 项。 */
  availableShortLinks?: number;
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
  const { providerAccounts, hasBackendApiKey, updateProviderAccount, setToast, requestConfirm, onBatchCreated, deductQuotaLocally, syncQuotaFromBackend, availableShortLinks = 0 } = deps;

  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [histories, setHistories] = useState<HistoryRecord[]>([]);
  const activeBatchIdsRef = useRef(new Set<string>());
  activeBatchIdsRef.current = new Set(batches.map((batch) => batch.id));
  const backendRequestsRef = useRef(new Set<string>());
  const archivedRequestsRef = useRef(new Set<string>());

  // 启动时从 SQLite 恢复批次与历史（刷新不丢）。
  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }
    void (async () => {
      try {
        const [savedBatches, savedHistory] = await Promise.all([loadBatchesFromDb(), loadHistoryFromDb()]);
        knownBatchIdsRef.current = new Set(savedBatches.map((batch) => batch.id));
        setBatches((current) => (current.length > 0 ? current : normalizePlatformQueues(savedBatches)));
        setHistories((current) => (current.length > 0 ? current : savedHistory));
      } catch (error) {
        console.warn('加载批次/历史失败', error);
      }
    })();
  }, []);

  // 额度增加后，扣除尚未完成项已预留的额度，再按队列顺序释放等待项。
  useEffect(() => {
    setBatches((current) => {
      let free = availableShortLinks - current.reduce((sum, batch) => {
        const perItem = batch.shortLinkTargets.length;
        return sum + batch.items.filter((item) => item.status !== 'done' && item.status !== 'waiting_quota').length * perItem;
      }, 0);
      if (free <= 0) return current;
      let changed = false;
      const next = current.map((batch) => {
        const cost = batch.shortLinkTargets.length;
        if (cost === 0) return batch;
        const items = batch.items.map((item) => {
          if (item.status !== 'waiting_quota' || free < cost) return item;
          free -= cost;
          changed = true;
          return { ...item, status: 'pending' as const, step: '额度已恢复，排队等待' };
        });
        if (items === batch.items || !items.some((item, index) => item !== batch.items[index])) return batch;
        const waitingQuota = items.filter((item) => item.status === 'waiting_quota').length;
        return { ...batch, items, waitingQuota, status: batch.status === 'waiting_quota' ? 'queued' as const : batch.status };
      });
      return changed ? normalizePlatformQueues(next) : current;
    });
  }, [availableShortLinks]);

  // 批次变更时（去抖 2s）持久化到 SQLite，避免引擎 1.6s 轮询频繁写库。
  const batchSaveTimerRef = useRef<number | null>(null);
  const knownBatchIdsRef = useRef<Set<string>>(new Set());
  const batchWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }
    // 清理函数（return）会在每次 batches 变更前先 clear 上一轮定时器并置空 ref，
    // 因此这里无需再判空清理——直接设置新的去抖定时器即可。
    batchSaveTimerRef.current = window.setTimeout(() => {
      batchSaveTimerRef.current = null;
      const currentIds = new Set(batches.map((batch) => batch.id));
      batchWriteQueueRef.current = batchWriteQueueRef.current.catch(() => undefined).then(async () => {
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
      });
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
  // 此处只编排 UI 队列；真正的按平台间隔由 Rust 共享限流器强制执行。
  useEffect(() => {
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

      const account = providerAccounts.find((providerAccount) => providerAccount.id === item.accountId);
      backendRequestsRef.current.add(requestKey);
      appendBatchLog(batch.id, createBatchLog('info', '开始转存到我的网盘', item.title));
      void transferProviderShare({
        account,
        item,
        targetFolderRef: batch.targetFolderRef,
      })
        .then((result) => {
          if (!activeBatchIdsRef.current.has(batch.id)) return;
          appendBatchLog(batch.id, createBatchLog('success', `转存完成：${result.shareUrl}`, item.title));
          if (hasBackendApiKey && !batch.ydisksAccountId.trim()) {
            appendBatchLog(batch.id, createBatchLog('warning', '已连接 Ydisks，但本批次未绑定后台账号，跳过原始链接登记', item.title));
          }
          // 仅转存模式（无 API Key 或未绑定后台账号）：跳过后台登记，直接完成。
          // 有后台登记需求时才推进到 creating_original，由短链 effect 接管。
          const next = deriveTransferSuccessUpdate(batch, hasBackendApiKey ? 'configured' : '', result.shareUrl);
          updateQueueItem(batch.id, item.id, (currentItem) => ({ ...currentItem, ...next }));
        })
        .catch((error) => {
          if (!activeBatchIdsRef.current.has(batch.id)) return;
          const message = formatBackendError(error);
          console.error('[Ydisks Transfer] 转存失败', {
            batchId: batch.id,
            itemId: item.id,
            title: item.title,
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
  }, [batches, providerAccounts, hasBackendApiKey]);

  // 短链 effect：对每个 running 批次中待登记项发起 createBackendLinks。
  useEffect(() => {
    batches.forEach((batch) => {
      if (!batch.localEngine || batch.status !== 'running') {
        return;
      }

      const item = findItemToShortlink(batch) ?? batch.items.find((candidate) => candidate.status === 'creating_shortlink' && Boolean(candidate.originalLinkId));
      if (!item) {
        return;
      }

      const requestKey = `${batch.id}:${item.id}`;
      // 防御性去重：本 effect 在发起请求前已同步将项翻转为 creating_shortlink（见下文 updateQueueItem），
      // 故同一项不会被 findItemToShortlink 二次命中，此分支当前不可达。保留以防未来将翻转改为异步
      // （参照转存 effect 的异步翻转）时对同一项重复发起 createBackendLinks（会造成重复扣费/建链）。
      if (backendRequestsRef.current.has(requestKey)) {
        return;
      }

      const completedChannels = new Set((item.shortLinks ?? []).map((link) => `${link.channelId ?? ''}:${link.domain}`));
      const nextTarget = batch.shortLinkTargets.find((target) => !completedChannels.has(`${target.channelId}:${target.domain}`));
      backendRequestsRef.current.add(requestKey);
      const creatingOriginal = !item.originalLinkId;
      appendBatchLog(
        batch.id,
        createBatchLog(
          'info',
          creatingOriginal ? '开始登记后台原始链接' : nextTarget ? `开始创建渠道短链：${nextTarget.channelName}` : '后台链接创建完成',
          item.title,
        ),
      );
      updateQueueItem(batch.id, item.id, (currentItem) => ({
        ...currentItem,
        status: creatingOriginal ? 'creating_original' : 'creating_shortlink',
        step: creatingOriginal ? '当前处理：登记后台原始链接' : nextTarget ? `当前处理：创建 ${nextTarget.channelName} 短链` : '后台链接创建完成',
        progress: 85,
      }));

      const operation = creatingOriginal
        ? createBackendOriginalLink(item, batch.ydisksAccountId).then((originalLinkId) => ({ originalLinkId }))
        : nextTarget
          ? createBackendShortLink(item, nextTarget).then((shortLink) => ({ shortLink }))
          : Promise.resolve({ complete: true as const });
      void operation
        .then(async (result) => {
          if (!activeBatchIdsRef.current.has(batch.id)) return;
          if ('originalLinkId' in result) {
            const applyOriginal = (currentItem: QueueItem) => ({ ...currentItem, originalLinkId: result.originalLinkId, status: 'creating_shortlink' as const, progress: 75, step: '原始链接已登记' });
            // Persist the checkpoint before allowing the next stage to run.
            await saveBatchToDb(reduceQueueItemUpdate(batch, item.id, applyOriginal)).catch((error) => {
              console.warn('保存建链检查点失败', error);
            });
            if (!activeBatchIdsRef.current.has(batch.id)) return;
            updateQueueItem(batch.id, item.id, applyOriginal);
            return;
          }
          const shortLinks = 'shortLink' in result ? [...(item.shortLinks ?? []), result.shortLink] : (item.shortLinks ?? []);
          const complete = !nextTarget || shortLinks.length >= batch.shortLinkTargets.length;
          appendBatchLog(
            batch.id,
            createBatchLog(
              'success',
              complete ? `后台创建完成：${shortLinks.length} 个短链` : `渠道短链创建完成：${nextTarget?.channelName ?? ''}`,
              item.title,
            ),
          );
          // 本地乐观扣减短链用量，使「剩余额度」即时下降；真实额度在批次完成后与线上同步。
          if ('shortLink' in result) deductQuotaLocally(1);
          const applyShortLink = (currentItem: QueueItem): QueueItem => ({
            ...currentItem,
            error: undefined,
            progress: complete ? 100 : 85,
            shortLinks,
            shortUrl: shortLinks[0]?.shortUrl,
            status: complete ? 'done' : 'creating_shortlink',
            step: complete ? (shortLinks.length > 0 ? '短链创建完成' : '原始链接登记完成') : '继续创建渠道短链',
          });
          await saveBatchToDb(reduceQueueItemUpdate(batch, item.id, applyShortLink)).catch((error) => {
            console.warn('保存建链检查点失败', error);
          });
          if (!activeBatchIdsRef.current.has(batch.id)) return;
          updateQueueItem(batch.id, item.id, applyShortLink);
        })
        .catch((error) => {
          if (!activeBatchIdsRef.current.has(batch.id)) return;
          const message = formatBackendError(error);
          console.error('[Ydisks Transfer] 后台链接创建失败', {
            batchId: batch.id,
            itemId: item.id,
            title: item.title,
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
  }, [batches]);

  // 完成 effect：全部 done 的批次转为成功历史并移出运行列表，随后与线上同步短链额度。
  useEffect(() => {
    const completed = batches.filter(isBatchComplete);

    if (completed.length === 0) {
      return;
    }

    completed.forEach((batch) => {
      if (archivedRequestsRef.current.has(batch.id)) return;
      archivedRequestsRef.current.add(batch.id);
      const history = batchToHistory(batch, 'success');
      void archiveBatchInDb(batch.id, history).then(() => {
        knownBatchIdsRef.current.delete(batch.id);
        setHistories((current) => current.some((item) => item.id === history.id) ? current : [history, ...current]);
        setBatches((current) => normalizePlatformQueues(current.filter((item) => item.id !== batch.id)));
        void syncQuotaFromBackend();
      }).catch((error) => {
        archivedRequestsRef.current.delete(batch.id);
        console.warn('归档批次失败', error);
        setToast({ message: '批次已完成，但归档失败，将自动重试', tone: 'danger' });
        window.setTimeout(() => {
          setBatches((current) => current.some((item) => item.id === batch.id) ? [...current] : current);
        }, 1000);
      });
    });
    // 一批转存全部完成后，与线上同步真实短链额度（修正本地乐观扣减的累计误差）。
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
        const history = batchToHistory(batch, 'failed');
        void archiveBatchInDb(batchId, history).then(() => {
          knownBatchIdsRef.current.delete(batchId);
          setHistories((current) => [history, ...current]);
          setBatches((current) => normalizePlatformQueues(current.filter((item) => item.id !== batchId)));
          setToast({ message: '批次已取消', tone: 'info' });
        }).catch((error) => {
          console.warn('取消批次归档失败', error);
          setToast({ message: '取消失败：无法安全归档批次', tone: 'danger' });
        });
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
