// localStorage 持久化纯函数：网盘账号 / 主题模式 / API Key 的读写与清除。
//
// 这些函数直接读写 window.localStorage，并在 SSR（无 window）与异常时安全降级。
// 测试时通过 jsdom 提供的 localStorage 或注入 mock 覆盖。

import type { ProviderAccount } from '../types';
import {
  apiKeyStorageKey,
  legacyDemoProviderAccountIds,
  providerAccountsStorageKey,
  themeModeStorageKey,
} from './constants';
import { isThemeMode, normalizeStoredProviderAccounts } from './guards';
import type { ThemeMode } from './types';

/** 从 localStorage 读取并归一化网盘账号数组；无 window 或异常时返回空数组。 */
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

/** 把网盘账号数组写入 localStorage（剔除早期 demo 账号）。 */
export const saveStoredProviderAccounts = (accounts: ProviderAccount[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    providerAccountsStorageKey,
    JSON.stringify(accounts.filter((account) => !legacyDemoProviderAccountIds.has(account.id))),
  );
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

/** 读取已保存的 API Key；无 window 或异常时返回空串。 */
export const loadStoredApiKey = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.localStorage.getItem(apiKeyStorageKey) ?? '';
  } catch {
    return '';
  }
};

/** 保存 API Key 到 localStorage。 */
export const saveStoredApiKey = (key: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(apiKeyStorageKey, key);
  } catch {
    /* ignore quota / privacy errors */
  }
};

/** 清除已保存的 API Key。 */
export const clearStoredApiKey = () => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(apiKeyStorageKey);
  } catch {
    /* ignore */
  }
};
