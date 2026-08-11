// 纯数据常量：网盘平台键 / 标签 / 状态文案 / 默认目录引用 / 存储键。
//
// 这些常量被纯函数模块与 App.tsx 组件共用，集中导出以避免重复与漂移。

import type { BatchMonitor, ProviderKey, TaskStatus } from '../types';
import type { QuotaState, TransferIntervalSettings } from './types';

/** 受支持的网盘平台键。 */
export const providerKeys: ProviderKey[] = ['quark', 'baidu', 'xunlei'];

/** 旧版 localStorage 键：仅用于一次性迁移网盘账号。 */
export const providerAccountsStorageKey = 'ydisks.transfer.providerAccounts.v2';
/** localStorage 存储键：主题模式。 */
export const themeModeStorageKey = 'ydisks.transfer.themeMode.v1';
/** 旧版 localStorage 键：仅用于一次性迁移 API Key。 */
export const apiKeyStorageKey = 'ydisks.transfer.apiKey.v1';
/** 旧版 localStorage 键：仅用于一次性迁移按平台转存间隔。 */
export const transferIntervalsStorageKey = 'ydisks.transfer.intervals.v1';

/** 转存间隔默认 4 秒，任何平台均不得低于 3 秒。 */
export const minimumTransferIntervalSeconds = 3;
export const defaultTransferIntervals: TransferIntervalSettings = { quark: 4, baidu: 4, xunlei: 4 };

/** 早期 demo 账号 ID 集合：迁移与保存时一律剔除。 */
export const legacyDemoProviderAccountIds = new Set([
  'quark-main',
  'quark-backup',
  'baidu-course',
  'baidu-media',
  'xunlei-film',
]);

/** 网盘平台中文标签（含 unknown 兜底）。 */
export const providerLabels: Record<ProviderKey | 'unknown', string> = {
  quark: '夸克',
  baidu: '百度',
  xunlei: '迅雷',
  unknown: '未知',
};

/** 队列项状态中文标签。 */
export const statusLabels: Record<TaskStatus, string> = {
  pending: '待执行',
  waiting_quota: '等待额度',
  awaiting_login: '等待登录',
  transferring: '转存中',
  sharing: '创建分享',
  creating_original: '登记原始链接',
  creating_shortlink: '创建短链',
  manual_required: '人工处理',
  waiting_retry: '待重试',
  done: '完成',
};

/** 批次状态中文标签。 */
export const batchStatusLabels: Record<BatchMonitor['status'], string> = {
  running: '运行中',
  queued: '平台排队',
  paused: '已暂停',
  waiting_quota: '等待额度',
  manual_required: '人工处理',
  waiting_retry: '待重试',
};

/** 各平台默认目标目录引用。 */
export const defaultFolderRefs: Record<ProviderKey, string> = {
  quark: 'quark:fid:0',
  baidu: 'baidu:path:/',
  xunlei: 'xunlei:parent_id:0',
};

/** 初始空额度。 */
export const emptyQuota: QuotaState = {
  maxLinks: 0,
  usedLinks: 0,
};
