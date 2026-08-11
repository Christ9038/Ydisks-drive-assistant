import { describe, it, expect, vi } from 'vitest';
import {
  loadStoredProviderAccounts,
  loadStoredThemeMode,
  loadLegacyBusinessSettings,
  clearLegacyBusinessSettings,
  normalizeTransferIntervals,
  resolveThemeMode,
} from '../storage';

describe('纯配置归一化', () => {
  it('非法值回落默认值，低于 3 秒强制为 3 秒', () => {
    expect(normalizeTransferIntervals({ quark: 1, baidu: '8', xunlei: 'bad' }))
      .toEqual({ quark: 3, baidu: 8, xunlei: 4 });
  });
});

describe('主题模式（唯一允许的前端持久化配置）', () => {
  it('默认 system，合法值可读取，非法值回落', () => {
    expect(loadStoredThemeMode()).toBe('system');
    localStorage.setItem('ydisks.transfer.themeMode.v1', 'dark');
    expect(loadStoredThemeMode()).toBe('dark');
    localStorage.setItem('ydisks.transfer.themeMode.v1', 'pink');
    expect(loadStoredThemeMode()).toBe('system');
  });

  it('system 按系统主题解析', () => {
    expect(resolveThemeMode('light')).toBe('light');
    expect(resolveThemeMode('dark')).toBe('dark');
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(resolveThemeMode('system')).toBe('dark');
    spy.mockRestore();
  });
});

describe('旧账号一次性迁移读取', () => {
  it('读取并归一化旧账号，保留迁移所需 credential', () => {
    localStorage.setItem('ydisks.transfer.providerAccounts.v2', JSON.stringify([{
      id: 'q1', provider: 'quark', displayName: '旧账号', status: 'connected', cookie: 'secret-cookie',
    }]));
    const accounts = loadStoredProviderAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].hasCredential).toBe(true);
    expect((accounts[0] as typeof accounts[0] & { cookie?: string }).cookie).toBe('secret-cookie');
  });

  it('无数据、损坏数据及读取异常均返回空数组', () => {
    expect(loadStoredProviderAccounts()).toEqual([]);
    localStorage.setItem('ydisks.transfer.providerAccounts.v2', '{bad');
    expect(loadStoredProviderAccounts()).toEqual([]);
    const getter = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadStoredProviderAccounts()).toEqual([]);
    getter.mockRestore();
  });

  it('SSR 安全降级', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(loadStoredProviderAccounts()).toEqual([]);
      expect(loadStoredThemeMode()).toBe('system');
      expect(resolveThemeMode('system')).toBe('light');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('旧业务设置一次性迁移读取', () => {
  it('读取旧 API Key/间隔并在迁移成功后清理', () => {
    localStorage.setItem('ydisks.transfer.apiKey.v1', ' old-key ');
    localStorage.setItem('ydisks.transfer.intervals.v1', JSON.stringify({ quark: 1, baidu: 6, xunlei: 7 }));
    expect(loadLegacyBusinessSettings()).toEqual({
      apiKey: 'old-key', transferIntervals: { quark: 3, baidu: 6, xunlei: 7 },
    });
    clearLegacyBusinessSettings();
    expect(localStorage.getItem('ydisks.transfer.apiKey.v1')).toBeNull();
    expect(localStorage.getItem('ydisks.transfer.intervals.v1')).toBeNull();
  });
});
