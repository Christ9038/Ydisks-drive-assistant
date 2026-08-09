// 本地批次引擎纯函数：账号/导入项/日志/批次 ID 工厂，平台串行队列提升，
// 队列项状态推进，以及单个批次的一次推进（advanceLocalBatch）。
//
// 依赖时间的工厂函数（createProviderAccount / buildImportItem / createBatchLog /
// generateBatchId）使用 Date.now()/Math.random()，测试时按结构断言或 mock。

import type {
  BatchMonitor,
  ImportItem,
  ProviderAccount,
  ProviderKey,
  QueueItem,
  ShortLinkTarget,
} from '../types';
import { providerKeys } from './constants';
import { isActiveQueueStatus, isBlockingStatus, platformNameOf } from './guards';
import type { BatchDraft, BatchLogEntry, BatchRecord, ParsedResource } from './types';

/** 创建一个未登录的新账号对象（id 由时间戳+随机串保证唯一）。 */
export const createProviderAccount = (provider: ProviderKey, displayName: string): ProviderAccount => ({
  id: `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  provider,
  platformName: platformNameOf(provider),
  displayName,
  status: 'expired',
  loginName: '未登录',
  purpose: '',
  lastChecked: '-',
  pendingReason: '尚未登录',
});

/** 由解析资源生成导入项（默认 valid）。 */
export const buildImportItem = (resource: ParsedResource, accountId: string, index: number): ImportItem => ({
  id: `I-${Date.now()}-${index}`,
  provider: resource.provider,
  accountId,
  sourceUrl: resource.sourceUrl,
  title: resource.title,
  valid: true,
});

/** 当前时间格式化为 `YYYY-MM-DD HH:mm`。 */
export const formatNow = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

/** 创建一条批次日志（id 与 time 自动生成）。 */
export const createBatchLog = (
  tone: BatchLogEntry['tone'],
  message: string,
  itemTitle?: string,
): BatchLogEntry => ({
  id: `L-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  time: formatNow(),
  tone,
  message,
  itemTitle,
});

/** 生成批次 ID：`B-YYYYMMDD-HHMMSS`。 */
export const generateBatchId = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `B-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

/**
 * 平台串行队列规整：每个平台若无阻塞批次，则把队首排队批次提升为 running；
 * 其余排队批次按顺序重排 queuePosition。原地修改并返回同一数组。
 */
export const normalizePlatformQueues = (batches: BatchRecord[]) => {
  const next = [...batches];
  providerKeys.forEach((provider) => {
    const providerBatches = next.filter((batch) => batch.provider === provider);
    const hasBlockingBatch = providerBatches.some((batch) => isBlockingStatus(batch.status));
    const queuedBatches = providerBatches
      .filter((batch) => batch.status === 'queued')
      .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));

    if (!hasBlockingBatch && queuedBatches.length > 0) {
      const promoted = queuedBatches[0];
      promoted.status = 'running';
      promoted.queuePosition = undefined;
      promoted.currentStep = `串行处理第 ${promoted.currentIndex}/${promoted.total} 条`;
    }

    next
      .filter((batch) => batch.provider === provider && batch.status === 'queued')
      .forEach((batch, index) => {
        batch.queuePosition = index + 1;
      });
  });

  return next;
};

/** 由批次草稿生成初始队列项：超额项标记 waiting_quota，运行中批次的首项标记 transferring。 */
export const createQueueItemsFromDraft = (draft: BatchDraft, batchStatus: BatchMonitor['status']) => draft.resources.map((resource, index): QueueItem => {
  const inQuota = index < draft.executable;
  const isCurrent = batchStatus === 'running' && index === 0 && inQuota;
  return {
    ...resource,
    accountId: draft.providerAccountId,
    accountName: draft.providerAccountName,
    status: !inQuota ? 'waiting_quota' : isCurrent ? 'transferring' : 'pending',
    step: !inQuota ? '等待短链额度' : isCurrent ? '当前处理：检查登录态' : '排队等待',
    progress: isCurrent ? 12 : 0,
  };
});

/** 推进单个队列项到下一个状态（pending/awaiting_login→transferring→sharing→…）。 */
export const advanceQueueItem = (item: QueueItem, index: number, targets: ShortLinkTarget[]): QueueItem => {
  switch (item.status) {
    case 'pending':
    case 'awaiting_login':
      return {
        ...item,
        status: 'transferring',
        step: '当前处理：转存到我的网盘',
        progress: 20,
      };
    case 'transferring':
      return {
        ...item,
        status: 'sharing',
        step: '当前处理：创建我的网盘链接',
        progress: 45,
      };
    case 'sharing':
      return {
        ...item,
        step: '当前处理：等待我的网盘链接',
      };
    case 'creating_original':
      return {
        ...item,
        step: '当前处理：等待后台原始链接结果',
      };
    case 'creating_shortlink':
      return {
        ...item,
        step: targets.length > 0 ? `当前处理：创建 ${targets.length} 个渠道短链` : '当前处理：登记后台原始链接',
      };
    default:
      return item;
  }
};

/**
 * 推进本地引擎批次一步：找到首个活跃项并推进；
 * 若无活跃项，按 waiting_quota / waiting_retry / manual_required 切换批次状态。
 * 全部完成时更新 currentStep 为「全部资源处理完成」。
 */
export const advanceLocalBatch = (batch: BatchRecord): BatchRecord => {
  if (!batch.localEngine || batch.status !== 'running') {
    return batch;
  }

  const activeIndex = batch.items.findIndex((item) => isActiveQueueStatus(item.status));
  if (activeIndex === -1) {
    const waitingQuota = batch.items.filter((item) => item.status === 'waiting_quota').length;
    const retrying = batch.items.filter((item) => item.status === 'waiting_retry').length;
    const manualRequired = batch.items.filter((item) => item.status === 'manual_required').length;
    if (manualRequired > 0) {
      return {
        ...batch,
        status: 'manual_required',
        retrying,
        currentStep: '等待人工处理',
        updatedAt: '刚刚',
      };
    }
    if (waitingQuota > 0) {
      return {
        ...batch,
        status: 'waiting_quota',
        waitingQuota,
        retrying,
        currentStep: '等待短链额度',
        updatedAt: '刚刚',
      };
    }
    if (retrying > 0) {
      return {
        ...batch,
        status: 'waiting_retry',
        retrying,
        currentStep: '等待重试',
        updatedAt: '刚刚',
      };
    }
    return batch;
  }

  const items = batch.items.map((item, index) => index === activeIndex
    ? advanceQueueItem(item, index, batch.shortLinkTargets)
    : item);
  const completed = items.filter((item) => item.status === 'done').length;
  const waitingQuota = items.filter((item) => item.status === 'waiting_quota').length;
  const retrying = items.filter((item) => item.status === 'waiting_retry').length;
  const currentIndex = Math.min(items.findIndex((item) => item.status !== 'done') + 1 || items.length, items.length);
  const activeProgress = items.find((item) => isActiveQueueStatus(item.status))?.progress ?? 0;
  const progress = Math.min(100, Math.round(((completed * 100) + activeProgress) / Math.max(items.length, 1)));

  return {
    ...batch,
    completed,
    currentIndex,
    items,
    progress,
    retrying,
    waitingQuota,
    currentStep: completed === items.length
      ? '全部资源处理完成'
      : `串行处理第 ${currentIndex}/${items.length} 条`,
    updatedAt: '刚刚',
  };
};
