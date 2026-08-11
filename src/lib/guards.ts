// 类型守卫与判定纯函数：平台键 / 状态 / 主题校验，账号可用性、阻塞判定、
// 后台账号类型名映射，以及 localStorage 账号数组的归一化。

import type {
  BatchMonitor,
  ProviderAccount,
  ProviderKey,
  ProviderStatus,
  TaskStatus,
} from '../types';
import {
  legacyDemoProviderAccountIds,
  providerKeys,
  providerLabels,
} from './constants';
import type { QuotaState, ThemeMode } from './types';

/** 剩余可用短链额度，最小为 0。 */
export const remainingLinksOf = (quota: QuotaState) => Math.max(quota.maxLinks - quota.usedLinks, 0);

/** 判断值是否为受支持的网盘平台键。 */
export const isProviderKey = (value: unknown): value is ProviderKey => (
  typeof value === 'string' && providerKeys.includes(value as ProviderKey)
);

/** 判断值是否为合法的账号登录状态。 */
export const isProviderStatus = (value: unknown): value is ProviderStatus => (
  value === 'connected' || value === 'expired' || value === 'manual_required'
);

/** 判断值是否为合法的主题模式。 */
export const isThemeMode = (value: unknown): value is ThemeMode => (
  value === 'light' || value === 'dark' || value === 'system'
);

/** 网盘平台中文名，固定以「网盘」结尾。 */
export const platformNameOf = (provider: ProviderKey) => `${providerLabels[provider]}网盘`;

/** 取账号显示名；未匹配时返回「未分配」。 */
export const providerAccountLabel = (accounts: ProviderAccount[], accountId?: string) => {
  const account = accounts.find((item) => item.id === accountId);
  return account ? account.displayName : '未分配';
};

/** 账号是否可用：已连接且 Rust 确认持有登录态。 */
export const isProviderAccountUsable = (account: ProviderAccount) => account.status === 'connected' && account.hasCredential;

/**
 * 把后台账号类型名称映射到本地网盘平台；名称不含已知网盘品牌时返回 null。
 * 例如 "夸克网盘" → "quark"、"百度网盘" → "baidu"、"迅雷网盘" → "xunlei"。
 */
export const providerOfAccountTypeName = (accountTypeName?: string): ProviderKey | null => {
  if (!accountTypeName) {
    return null;
  }
  if (accountTypeName.includes('夸克')) {
    return 'quark';
  }
  if (accountTypeName.includes('百度')) {
    return 'baidu';
  }
  if (accountTypeName.includes('迅雷')) {
    return 'xunlei';
  }
  return null;
};

/** 批次是否处于阻塞状态（非排队即阻塞，排队中的批次允许被提升）。 */
export const isBlockingStatus = (status: BatchMonitor['status']) => status !== 'queued';

/** 队列项是否处于活跃处理状态（仍在推进流程中）。 */
export const isActiveQueueStatus = (status: TaskStatus) => [
  'pending',
  'awaiting_login',
  'transferring',
  'sharing',
  'creating_original',
  'creating_shortlink',
].includes(status);

/** 迅雷授权待完成类消息（扫码中 / authorization_pending / slow_down）。 */
export const isXunleiAuthorizationPendingMessage = (message: string) => (
  /未完成|等待扫码|authorization_pending|authorization pending|slow_down/i.test(message)
);

/** 凭证类错误消息（登录态失效 / 401 / cookie / token 过期等）。 */
export const isCredentialErrorMessage = (message: string) => /auth|401|登录|Cookie|token|凭证|授权|过期|失效/.test(message);

/** 账号是否处于「等待用户在官方/授权窗口完成登录」状态。 */
export const isAwaitingProviderLogin = (account: ProviderAccount) => account.status === 'manual_required'
  && (
    account.pendingReason?.includes('官方窗口')
    || account.pendingReason?.includes('授权窗口')
    || account.pendingReason?.includes('扫码授权')
    || account.pendingReason?.includes('扫码确认')
  );

/**
 * 归一化 localStorage 中的账号数组：剔除非对象 / 缺 id / 平台非法 / 早期 demo 账号，
 * 并补齐各字段默认值。返回值即可直接用于前端状态。
 */
export const normalizeStoredProviderAccounts = (value: unknown): ProviderAccount[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.id === 'string' && isProviderKey(item.provider))
    .filter((item) => !legacyDemoProviderAccountIds.has(item.id as string))
    .map((item) => {
      const provider = item.provider as ProviderKey;
      return {
        id: item.id as string,
        provider,
        platformName: typeof item.platformName === 'string' && item.platformName.trim()
          ? item.platformName
          : platformNameOf(provider),
        displayName: typeof item.displayName === 'string' && item.displayName.trim()
          ? item.displayName
          : `${providerLabels[provider]}账号`,
        status: isProviderStatus(item.status) ? item.status : 'expired',
        loginName: typeof item.loginName === 'string' && item.loginName.trim() ? item.loginName : '未登录',
        purpose: typeof item.purpose === 'string' ? item.purpose : '',
        lastChecked: typeof item.lastChecked === 'string' && item.lastChecked.trim() ? item.lastChecked : '-',
        pendingReason: typeof item.pendingReason === 'string' ? item.pendingReason : undefined,
        hasCredential: typeof item.cookie === 'string' && Boolean(item.cookie.trim()),
        // 仅供启动时一次性迁移到 Rust；迁移完成后立即删除 localStorage。
        cookie: typeof item.cookie === 'string' && item.cookie.trim() ? item.cookie : undefined,
      };
    });
};
