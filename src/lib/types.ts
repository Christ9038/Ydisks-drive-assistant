// 前端共享类型：从 App.tsx 抽离的跨模块数据结构与 Rust 行类型。
//
// 这些类型在纯函数模块（parsing / csv / mappers / engine / guards / storage）
// 与 App.tsx 组件之间共享，统一放在此处以避免重复定义与结构漂移。

import type {
  BatchMonitor,
  HistoryBatch,
  ImportItem,
  ProviderKey,
  ProviderStatus,
  QueueItem,
  ShortLinkTarget,
} from '../types';

/** 主题模式：light/dark 跟随系统。 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 各网盘平台两次转存发起之间的最小间隔（秒）。 */
export type TransferIntervalSettings = Record<ProviderKey, number>;

/** 后台短链额度快照。 */
export interface QuotaState {
  maxLinks: number;
  usedLinks: number;
  shortlinkAccessStatus?: string;
}

/** 解析后的单条资源（标题 + 源地址 + 平台）。 */
export interface ParsedResource {
  title: string;
  sourceUrl: string;
  provider: ProviderKey | 'unknown';
}

/** 添加资源结果：新增数 + 被过滤数。 */
export interface AddResourcesResult {
  added: number;
  filtered: number;
}

/** 批次草稿：提交批量转存前的中间态。 */
export interface BatchDraft {
  provider: ProviderKey;
  providerAccountId: string;
  providerAccountName: string;
  ydisksAccountId: string;
  ydisksAccountName: string;
  targetFolderRef: string;
  shortLinkTargets: ShortLinkTarget[];
  resources: ImportItem[];
  executable: number;
  waitingQuota: number;
}

/** 后端错误载荷：Rust 侧返回的 { stage, code, message, details }。 */
export interface BackendErrorPayload {
  stage?: string;
  code?: number;
  message?: string;
  details?: Record<string, string>;
}

/** 批次日志条目。 */
export interface BatchLogEntry {
  id: string;
  time: string;
  tone: 'info' | 'success' | 'danger' | 'warning';
  message: string;
  itemTitle?: string;
}

/** Ydisks 后台账号选项（含网盘类型名用于平台筛选）。 */
export interface YdisksAccountOption {
  id: string;
  name: string;
  /** 后台账号类型名称，例如 "夸克网盘"，用于按网盘平台筛选。 */
  accountTypeName?: string;
}

/** Rust 返回的脱敏账号视图，不包含 credential。 */
export interface RustAccountRow {
  id: string;
  provider: ProviderKey;
  displayName: string;
  status: ProviderStatus;
  loginName: string;
  purpose: string;
  lastChecked: string;
  pendingReason?: string;
  hasCredential: boolean;
}

/** 后端 SQLite 批次行。items/logs/shortLinkTargets 以 JSON 字符串存储。 */
export interface RustBatchRow {
  id: string;
  status: string;
  provider: ProviderKey;
  providerAccountId: string;
  providerAccountName: string;
  ydisksAccountId: string;
  ydisksAccountName: string;
  targetFolderRef: string;
  shortLinkTargetCount: number;
  total: number;
  completed: number;
  currentIndex: number;
  queuePosition?: number | null;
  retrying: number;
  waitingQuota: number;
  progress: number;
  currentStep: string;
  localEngine: boolean;
  itemsJson: string;
  logsJson: string;
  shortLinkTargetsJson: string;
  createdAt: string;
  updatedAt: string;
}

/** 后端 SQLite 历史行。 */
export interface RustHistoryRow {
  id: string;
  batchId: string;
  status: 'success' | 'failed';
  createdAt: string;
  total: number;
  completed: number;
  failed: number;
  itemsJson: string;
  logsJson: string;
}

export interface RustParsedImportResource {
  title: string;
  source_url: string;
  provider: ProviderKey | 'unknown';
}

export interface RustImportParseResult {
  accepted: RustParsedImportResource[];
  filtered: number;
}

export interface RustBackendCreationResult {
  originalLinkId: string;
  shortLinks: Array<{
    channelId: string;
    channelName: string;
    domain: string;
    shortUrl: string;
  }>;
}

export interface RustQuarkTransferResult {
  shareUrl: string;
  savedFids: string[];
  title: string;
}

export interface RustQuarkLoginResult {
  loginName: string;
  cookieCount: number;
  hasCredential: boolean;
}

export interface RustBusinessSettings {
  transferIntervals: TransferIntervalSettings;
  hasApiKey: boolean;
}

export interface RustProviderLoginEvent {
  accountId: string;
  provider: ProviderKey;
  result: RustQuarkLoginResult;
}

/** 迅雷二次验证完成事件负载：`xunlei-review-complete` 广播，供前端自动继续登录 + 关闭验证窗口。 */
export interface RustXunleiReviewCompleteEvent {
  /** 触发本次验证的窗口 label，前端据此关闭对应验证窗口。 */
  windowLabel: string;
  /** 验证返回的 CreditKey；为空表示验证完成但页面未返回 CreditKey。 */
  creditKey: string;
}

export interface RustXunleiLoginQrResult {
  userCode: string;
  qrcodeSvg: string;
  qrcodeUrl: string;
  expiresIn: number;
}

export interface RustXunleiLoginCheckResult {
  status: 'pending' | 'connected';
  result?: RustQuarkLoginResult | null;
}

export interface RustProviderFolderItem {
  name: string;
  folderRef: string;
  parentRef: string;
  isDir: boolean;
}

export interface RustBackendAssetsSnapshot {
  quota: {
    maxLinks: number;
    usedLinks: number;
    remainingLinks: number;
    shortlinkAccessStatus: string;
  };
  accounts: YdisksAccountOption[];
  channels: Array<{
    id: string;
    name: string;
  }>;
  domains: Array<{
    domainName: string;
    status: string;
  }>;
}

export type DomainOption = RustBackendAssetsSnapshot['domains'][number];

export interface RustBackendQuotaSummary {
  maxLinks: number;
  usedLinks: number;
  remainingLinks: number;
  shortlinkAccessStatus: string;
}

/** 运行中的批次记录：扩展 BatchMonitor，附加队列项 / 日志 / 短链目标。 */
export interface BatchRecord extends BatchMonitor {
  items: QueueItem[];
  localEngine?: boolean;
  logs: BatchLogEntry[];
  shortLinkTargets: ShortLinkTarget[];
}

/** 历史批次记录：扩展 HistoryBatch，附加队列项与日志。 */
export interface HistoryRecord extends HistoryBatch {
  items: QueueItem[];
  logs?: BatchLogEntry[];
}
