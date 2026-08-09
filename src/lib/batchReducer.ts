// 批次状态机纯转移函数：把 App 中内联的批次级状态转移抽离为可单测的纯函数。
//
// 这些函数只读取入参批次（与可选的现有批次列表 / 平台阻塞判定），返回新批次对象，
// 不触碰 React state、不发起网络请求、不产生副作用。日志追加统一截断为最近 80 条。
// 时间相关字段（updatedAt）由调用方在 App 层填 '刚刚'；这里只负责结构转换。

import type { BatchMonitor, HistoryBatch, QueueItem } from '../types';
import { isActiveQueueStatus, isBlockingStatus } from './guards';
import { createBatchLog } from './engine';
import { providerLabels } from './constants';
import type { BatchRecord, HistoryRecord } from './types';

/** 日志环上限：每批次只保留最近 80 条日志。 */
const MAX_LOGS = 80;

/** 在现有日志前追加一条新日志，截断到上限。 */
function prependLog(logs: BatchRecord['logs'] | undefined, entry: ReturnType<typeof createBatchLog>) {
  return [entry, ...(logs ?? [])].slice(0, MAX_LOGS);
}

/**
 * 重新计算批次的派生字段：依据队列项状态聚合 completed / waitingQuota / retrying /
 * manualRequired / currentIndex / progress / status / currentStep。
 *
 * `itemUpdater` 仅作用于匹配 `itemId` 的队列项；其余项原样保留。
 * 仅当批次为 `running` 且无活跃项时，才依阻塞项类型回落到 manual / retry 状态。
 */
export function reduceQueueItemUpdate(
  batch: BatchRecord,
  itemId: string,
  itemUpdater: (item: QueueItem) => QueueItem,
): BatchRecord {
  const items = batch.items.map((item) => (item.id === itemId ? itemUpdater(item) : item));
  const completed = items.filter((item) => item.status === 'done').length;
  const waitingQuota = items.filter((item) => item.status === 'waiting_quota').length;
  const retrying = items.filter((item) => item.status === 'waiting_retry').length;
  const manualRequired = items.filter((item) => item.status === 'manual_required').length;
  const nextIndex = items.findIndex((item) => item.status !== 'done');
  const currentIndex = nextIndex === -1 ? items.length : nextIndex + 1;
  const activeProgress = items.find((item) => isActiveQueueStatus(item.status))?.progress ?? 0;
  const progress = Math.min(100, Math.round(((completed * 100) + activeProgress) / Math.max(items.length, 1)));
  const hasActiveItem = items.some((item) => isActiveQueueStatus(item.status));
  const status: BatchMonitor['status'] = batch.status === 'running' && !hasActiveItem
    ? manualRequired > 0
      ? 'manual_required'
      : retrying > 0
        ? 'waiting_retry'
        : batch.status
    : batch.status;
  const currentStep = completed === items.length
    ? '全部资源处理完成'
    : !hasActiveItem && manualRequired > 0
      ? '等待人工处理'
      : !hasActiveItem && retrying > 0
        ? '等待重试'
        : !hasActiveItem && waitingQuota > 0
          ? '等待短链额度'
          : `串行处理第 ${currentIndex}/${items.length} 条`;

  return {
    ...batch,
    completed,
    currentIndex,
    currentStep,
    items,
    progress,
    retrying,
    status,
    updatedAt: '刚刚',
    waitingQuota,
  };
}

/** 暂停批次：状态置 `paused`，记录暂停日志。 */
export function reducePauseBatch(batch: BatchRecord): BatchRecord {
  return {
    ...batch,
    status: 'paused',
    currentStep: '用户暂停',
    updatedAt: '刚刚',
    logs: prependLog(batch.logs, createBatchLog('warning', '用户暂停批次')),
  };
}

/**
 * 继续批次：若同平台已有阻塞批次则进 `queued`，否则进 `running`。
 *
 * `hasPlatformBlocker` 由调用方按「同平台其它批次存在阻塞状态」判定后传入，
 * 避免此纯函数依赖完整批次列表。
 */
export function reduceContinueBatch(batch: BatchRecord, hasPlatformBlocker: boolean): BatchRecord {
  return {
    ...batch,
    status: hasPlatformBlocker ? 'queued' : 'running',
    currentStep: hasPlatformBlocker
      ? `同平台排队：等待${providerLabels[batch.provider]}当前批次完成`
      : `串行处理第 ${batch.currentIndex}/${batch.total} 条`,
    updatedAt: '刚刚',
    logs: prependLog(batch.logs, createBatchLog('info', hasPlatformBlocker ? '继续后进入同平台队列' : '用户继续批次')),
  };
}

/** 重试整批：把 `waiting_retry` 项重置为 `pending`，清零 retrying 计数。 */
export function reduceRetryBatch(batch: BatchRecord): BatchRecord {
  return {
    ...batch,
    status: 'running',
    retrying: 0,
    currentStep: `串行处理第 ${batch.currentIndex}/${batch.total} 条`,
    updatedAt: '刚刚',
    logs: prependLog(batch.logs, createBatchLog('info', '重试所有待处理项')),
    items: batch.items.map((item) => item.status === 'waiting_retry'
      ? retryTargetForItem(item)
      : item),
  };
}

/** 重试单条：重置该项，retrying 计数减一（不低于 0）。 */
export function reduceRetryQueueItem(batch: BatchRecord, itemId: string): BatchRecord {
  const title = batch.items.find((item) => item.id === itemId)?.title;
  return {
    ...batch,
    retrying: Math.max(batch.retrying - 1, 0),
    updatedAt: '刚刚',
    logs: prependLog(batch.logs, createBatchLog('info', '重试单条资源', title)),
    items: batch.items.map((item) => item.id === itemId
      ? { ...retryTargetForItem(item), progress: 0 }
      : item),
  };
}

/**
 * 计算重试时项应回到的目标状态，避免重复转存：
 * - 已有 shareUrl（转存已完成，仅后台登记/短链失败）-> `creating_original`，跳过转存；
 * - 无 shareUrl（转存本身失败或未开始）-> `pending`，重新转存。
 */
function retryTargetForItem(item: QueueItem): QueueItem {
  if (item.shareUrl) {
    return { ...item, status: 'creating_original', step: '排队等待后台登记', error: undefined };
  }
  return { ...item, status: 'pending', step: '排队等待', error: undefined };
}

/**
 * 把批次转为历史记录项（`success` / `failed`）。
 *
 * `failed` 时失败数取 `total - completed`（至少 1）；`success` 时完成数记为 `total`。
 */
export function batchToHistory(batch: BatchRecord, status: HistoryBatch['status']): HistoryRecord {
  const failed = status === 'failed' ? Math.max(batch.total - batch.completed, 1) : 0;
  const finalLog = createBatchLog(
    status === 'success' ? 'success' : 'danger',
    status === 'success' ? '批次完成，已进入历史记录' : '批次取消或失败，已进入历史记录',
  );
  return {
    id: batch.id,
    status,
    createdAt: batch.createdAt,
    total: batch.total,
    completed: status === 'success' ? batch.total : batch.completed,
    failed,
    items: batch.items,
    logs: [finalLog, ...(batch.logs ?? [])],
  };
}

/** 判定同平台是否已有阻塞批次（供 `reduceContinueBatch` 的 blocker 入参派生）。 */
export function hasSamePlatformBlocker(allBatches: BatchRecord[], batchId: string, provider: BatchRecord['provider']): boolean {
  return allBatches.some((batch) => batch.id !== batchId && batch.provider === provider && isBlockingStatus(batch.status));
}

// === 引擎决策谓词 ===
// 编码本地引擎「何时对哪个队列项发起网络请求 / 何时判定批次完成」的规则。
// 纯函数、无副作用，供 `useBatchEngine` 的 effect 调用并单测覆盖。

/**
 * 找出批次中待转存的队列项：状态为 `sharing` 且尚未拿到转存分享链接。
 *
 * 引擎的转存 effect 对每个 `running` 批次调用此函数定位需要发起 `transferProviderShare` 的项。
 * 非本地引擎 / 非运行批次由调用方先行过滤，这里只做项级判定。
 */
export function findItemToTransfer(batch: BatchRecord): QueueItem | undefined {
  return batch.items.find((item) => item.status === 'sharing' && !item.shareUrl);
}

/**
 * 找出批次中待创建后台链接的队列项：状态为 `creating_original`、已有转存分享链接、尚未登记原始链接 ID。
 *
 * 引擎的短链 effect 据此定位需要发起 `createBackendLinks` 的项。
 */
export function findItemToShortlink(batch: BatchRecord): QueueItem | undefined {
  return batch.items.find((item) => item.status === 'creating_original' && Boolean(item.shareUrl) && !item.originalLinkId);
}

/**
 * 判定批次是否已全部完成（本地引擎 + 有队列项 + 全部 `done`）。
 *
 * 引擎的完成 effect 据此把批次转为成功历史并从运行列表移除。
 */
export function isBatchComplete(batch: BatchRecord): boolean {
  return Boolean(batch.localEngine)
    && batch.items.length > 0
    && batch.items.every((item) => item.status === 'done');
}

/**
 * 判定批次是否需要后台登记（创建原始链接 + 短链）。
 *
 * 仅当配置了 API Key 且批次绑定了 Ydisks 后台账号时才走后台登记；
 * 否则视为「仅转存」模式：转存成功后直接置 `done`，跳过 `createBackendLinks`。
 * 这使得用户无需 API Key 即可完成基本的批量转存，短链作为需要连接后台的高阶能力。
 */
export function needsBackendRegistration(batch: BatchRecord, apiKey: string): boolean {
  return Boolean(apiKey.trim()) && Boolean(batch.ydisksAccountId.trim());
}
