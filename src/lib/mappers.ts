// 行映射纯函数：前端领域对象 ↔ Rust SQLite 行之间的双向转换，
// 以及从后台资产快照构建短链目标列表。

import type {
  BatchMonitor,
  ProviderAccount,
  QueueItem,
  ShortLinkTarget,
} from '../types';
import { platformNameOf } from './guards';
import type {
  BatchLogEntry,
  BatchRecord,
  DomainOption,
  HistoryRecord,
  RustAccountRow,
  RustBackendAssetsSnapshot,
  RustBatchRow,
  RustHistoryRow,
} from './types';

/** 安全解析 JSON 字符串为数组；解析失败或非数组时返回空数组。 */
export const safeParseJsonArray = <T,>(json: string): T[] => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
};

/** 前端账号 → Rust 可编辑元数据；不包含 Cookie/Token。 */
export const accountToRow = (account: ProviderAccount): RustAccountRow => ({
  id: account.id,
  provider: account.provider,
  displayName: account.displayName,
  status: account.status,
  loginName: account.loginName,
  purpose: account.purpose,
  lastChecked: account.lastChecked,
  pendingReason: account.pendingReason,
  hasCredential: account.hasCredential,
});

/** SQLite 账号行 → 前端账号（补平台名）。 */
export const accountFromRow = (row: RustAccountRow): ProviderAccount => ({
  id: row.id,
  provider: row.provider,
  platformName: platformNameOf(row.provider),
  displayName: row.displayName,
  status: row.status,
  loginName: row.loginName,
  purpose: row.purpose,
  lastChecked: row.lastChecked,
  pendingReason: row.pendingReason,
  hasCredential: row.hasCredential,
});

/** 运行中批次 → SQLite 批次行（items/logs/shortLinkTargets 序列化为 JSON）。 */
export const batchToRow = (batch: BatchRecord): RustBatchRow => ({
  id: batch.id,
  status: batch.status,
  provider: batch.provider,
  providerAccountId: '',
  providerAccountName: batch.providerAccountName,
  ydisksAccountId: batch.ydisksAccountId,
  ydisksAccountName: batch.ydisksAccountName,
  targetFolderRef: batch.targetFolderRef,
  shortLinkTargetCount: batch.shortLinkTargetCount,
  total: batch.total,
  completed: batch.completed,
  currentIndex: batch.currentIndex,
  queuePosition: batch.queuePosition ?? null,
  retrying: batch.retrying,
  waitingQuota: batch.waitingQuota,
  progress: batch.progress,
  currentStep: batch.currentStep,
  localEngine: Boolean(batch.localEngine),
  itemsJson: JSON.stringify(batch.items ?? []),
  logsJson: JSON.stringify(batch.logs ?? []),
  shortLinkTargetsJson: JSON.stringify(batch.shortLinkTargets ?? []),
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
});

/** SQLite 批次行 → 运行中批次（反序列化 items/logs/shortLinkTargets）。 */
export const batchFromRow = (row: RustBatchRow): BatchRecord => ({
  id: row.id,
  status: row.status as BatchMonitor['status'],
  provider: row.provider,
  providerAccountName: row.providerAccountName,
  ydisksAccountId: row.ydisksAccountId,
  ydisksAccountName: row.ydisksAccountName,
  targetFolderRef: row.targetFolderRef,
  shortLinkTargetCount: row.shortLinkTargetCount,
  total: row.total,
  completed: row.completed,
  currentIndex: row.currentIndex,
  queuePosition: row.queuePosition ?? undefined,
  retrying: row.retrying,
  waitingQuota: row.waitingQuota,
  progress: row.progress,
  currentStep: row.currentStep,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  localEngine: row.localEngine,
  items: safeParseJsonArray<QueueItem>(row.itemsJson),
  logs: safeParseJsonArray<BatchLogEntry>(row.logsJson),
  shortLinkTargets: safeParseJsonArray<ShortLinkTarget>(row.shortLinkTargetsJson),
});

/** 历史记录 → SQLite 历史行（items/logs 序列化为 JSON）。 */
export const historyToRow = (history: HistoryRecord): RustHistoryRow => ({
  id: history.id,
  batchId: history.id,
  status: history.status,
  createdAt: history.createdAt,
  total: history.total,
  completed: history.completed,
  failed: history.failed,
  itemsJson: JSON.stringify(history.items ?? []),
  logsJson: JSON.stringify(history.logs ?? []),
});

/** SQLite 历史行 → 历史记录（反序列化 items/logs）。 */
export const historyFromRow = (row: RustHistoryRow): HistoryRecord => ({
  id: row.id,
  status: row.status,
  createdAt: row.createdAt,
  total: row.total,
  completed: row.completed,
  failed: row.failed,
  items: safeParseJsonArray<QueueItem>(row.itemsJson),
  logs: safeParseJsonArray<BatchLogEntry>(row.logsJson),
});

/**
 * 从后台资产快照构建短链目标列表：每个渠道一个目标，
 * 优先复用已有目标的域名（需仍可用），否则取首个可用域名；
 * 渠道/账号/域名缺失时回退到 fallbackTargets。
 */
export const buildTargetsFromBackendAssets = (
  assets: RustBackendAssetsSnapshot,
  fallbackTargets: ShortLinkTarget[],
) => {
  const firstAccount = assets.accounts[0];
  const activeDomains = assets.domains.filter((domain) => domain.status === 'ACTIVE');
  const availableDomains: DomainOption[] = activeDomains.length > 0 ? activeDomains : assets.domains;
  const existingDomains = new Set(availableDomains.map((domain) => domain.domainName));
  const defaultDomain = availableDomains[0]?.domainName ?? fallbackTargets[0]?.domain ?? '';

  if (assets.channels.length === 0 || !firstAccount || !defaultDomain) {
    return fallbackTargets;
  }

  return assets.channels.map((channel) => {
    const existing = fallbackTargets.find((target) => target.channelId === channel.id || target.id === channel.id);
    const domain = existing?.domain && existingDomains.has(existing.domain)
      ? existing.domain
      : defaultDomain;
    return {
      id: channel.id,
      channelId: channel.id,
      channelName: channel.name,
      domain,
      ydisksAccountId: firstAccount.id,
      ydisksAccountName: firstAccount.name,
      enabled: existing?.enabled ?? true,
    };
  });
};
