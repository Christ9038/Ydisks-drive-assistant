// localStorage 仅保存纯前端主题偏好；账号读取只用于旧版本的一次性迁移。
//
// 这些函数直接读写 window.localStorage，并在 SSR（无 window）与异常时安全降级。
// 测试时通过 jsdom 提供的 localStorage 或注入 mock 覆盖。

import {
  apiKeyStorageKey,
  providerAccountsStorageKey,
  themeModeStorageKey,
  transferIntervalsStorageKey,
  defaultTransferIntervals,
  minimumTransferIntervalSeconds,
} from './constants';
import { isThemeMode, normalizeStoredProviderAccounts } from './guards';
import type { ThemeMode, TransferIntervalSettings } from './types';

const normalizeTransferInterval = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(minimumTransferIntervalSeconds, Math.round(parsed)) : fallback;
};

export const normalizeTransferIntervals = (value: unknown): TransferIntervalSettings => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    quark: normalizeTransferInterval(record.quark, defaultTransferIntervals.quark),
    baidu: normalizeTransferInterval(record.baidu, defaultTransferIntervals.baidu),
    xunlei: normalizeTransferInterval(record.xunlei, defaultTransferIntervals.xunlei),
  };
};

/** 从旧版 localStorage 读取账号用于一次性迁移；新版本绝不向此处写账号。 */
export const loadStoredProviderAccounts = () => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    return normalizeStoredProviderAccounts(JSON.parse(window.localStorage.getItem(providerAccountsStorageKey) ?? '[]'));
  } catch {
    return [];
  }
};

/** 读取旧版业务配置，仅用于成功迁移到 Rust 前的启动流程。 */
export const loadLegacyBusinessSettings = (): { apiKey?: string; transferIntervals?: TransferIntervalSettings } => {
  if (typeof window === 'undefined') return {};
  try {
    const apiKey = window.localStorage.getItem(apiKeyStorageKey)?.trim() || undefined;
    const rawIntervals = window.localStorage.getItem(transferIntervalsStorageKey);
    return {
      apiKey,
      transferIntervals: rawIntervals ? normalizeTransferIntervals(JSON.parse(rawIntervals)) : undefined,
    };
  } catch {
    return {};
  }
};

/** Rust 确认迁移成功后清理旧业务配置。 */
export const clearLegacyBusinessSettings = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(apiKeyStorageKey);
    window.localStorage.removeItem(transferIntervalsStorageKey);
  } catch {
    /* 旧数据清理失败不影响 Rust 已保存的配置 */
  }
};

/** 读取主题模式；非法值或无 window 时返回 'system'。 */
export const loadStoredThemeMode = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'system';
  }

  try {
    const value = window.localStorage.getItem(themeModeStorageKey);
    return isThemeMode(value) ? value : 'system';
  } catch {
    return 'system';
  }
};

/** 把主题模式解析为实际生效的 light/dark；system 跟随 prefers-color-scheme。 */
export const resolveThemeMode = (mode: ThemeMode): 'light' | 'dark' => {
  if (mode !== 'system' || typeof window === 'undefined') {
    return mode === 'dark' ? 'dark' : 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
