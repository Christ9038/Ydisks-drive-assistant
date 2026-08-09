export type ProviderKey = 'quark' | 'baidu' | 'xunlei';

export type ProviderStatus = 'connected' | 'expired' | 'manual_required';

export type TaskStatus =
  | 'pending'
  | 'waiting_quota'
  | 'awaiting_login'
  | 'transferring'
  | 'sharing'
  | 'creating_original'
  | 'creating_shortlink'
  | 'manual_required'
  | 'waiting_retry'
  | 'done';

export type PageKey =
  | 'tasks'
  | 'status'
  | 'history'
  | 'settings';

export interface ProviderAccount {
  id: string;
  provider: ProviderKey;
  platformName: string;
  displayName: string;
  status: ProviderStatus;
  loginName: string;
  purpose: string;
  lastChecked: string;
  pendingReason?: string;
  cookie?: string;
}

export interface ImportItem {
  id: string;
  provider: ProviderKey | 'unknown';
  accountId?: string;
  sourceUrl: string;
  title: string;
  valid: boolean;
  duplicated?: boolean;
}

export interface QueueItem extends ImportItem {
  status: TaskStatus;
  step: string;
  progress: number;
  accountName?: string;
  shareUrl?: string;
  originalLinkId?: string;
  shortUrl?: string;
  shortLinks?: ShortLinkResult[];
  error?: string;
}

export interface ShortLinkTarget {
  id: string;
  channelId: string;
  channelName: string;
  domain: string;
  ydisksAccountId: string;
  ydisksAccountName: string;
  enabled: boolean;
}

export interface ShortLinkResult {
  channelId?: string;
  channelName: string;
  domain: string;
  shortUrl: string;
}

export interface BatchMonitor {
  id: string;
  status: 'running' | 'queued' | 'paused' | 'waiting_quota' | 'manual_required' | 'waiting_retry';
  provider: ProviderKey;
  providerAccountName: string;
  ydisksAccountId: string;
  ydisksAccountName: string;
  targetFolderRef: string;
  shortLinkTargetCount: number;
  total: number;
  completed: number;
  currentIndex: number;
  queuePosition?: number;
  retrying: number;
  waitingQuota: number;
  progress: number;
  currentStep: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryBatch {
  id: string;
  status: 'success' | 'failed';
  createdAt: string;
  total: number;
  completed: number;
  failed: number;
}
