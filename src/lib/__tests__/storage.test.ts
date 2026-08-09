import { describe, it, expect, vi } from 'vitest';
import {
  loadStoredProviderAccounts,
  saveStoredProviderAccounts,
  loadStoredThemeMode,
  resolveThemeMode,
  loadStoredApiKey,
  saveStoredApiKey,
  clearStoredApiKey,
} from '../storage';
import type { ProviderAccount } from '../../types';

const account: ProviderAccount = {
  id: 'quark-1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主账号',
  status: 'connected',
  loginName: 'user',
  purpose: '',
  lastChecked: '-',
  cookie: 'c',
};

describe('API Key 持久化', () => {
  it('保存后可读取，清除后为空', () => {
    saveStoredApiKey('secret-key');
    expect(loadStoredApiKey()).toBe('secret-key');
    clearStoredApiKey();
    expect(loadStoredApiKey()).toBe('');
  });
  it('未保存时返回空串', () => {
    expect(loadStoredApiKey()).toBe('');
  });
});

describe('主题模式持久化', () => {
  it('未保存时返回 system', () => {
    expect(loadStoredThemeMode()).toBe('system');
  });
  it('保存后可读取（直接写 localStorage 模拟 App 侧保存）', () => {
    window.localStorage.setItem('ydisks.transfer.themeMode.v1', 'dark');
    expect(loadStoredThemeMode()).toBe('dark');
  });
  it('非法值回落 system', () => {
    window.localStorage.setItem('ydisks.transfer.themeMode.v1', 'pink');
    expect(loadStoredThemeMode()).toBe('system');
  });
});

describe('resolveThemeMode', () => {
  it('light/dark 直接返回', () => {
    expect(resolveThemeMode('light')).toBe('light');
    expect(resolveThemeMode('dark')).toBe('dark');
  });
  it('system 跟随 matchMedia（setup 中默认 false → light）', () => {
    expect(resolveThemeMode('system')).toBe('light');
  });
});

describe('网盘账号持久化', () => {
  it('保存后可读取并归一化', () => {
    saveStoredProviderAccounts([account]);
    const loaded = loadStoredProviderAccounts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('quark-1');
    expect(loaded[0].cookie).toBe('c');
  });

  it('保存时剔除 demo 账号', () => {
    const demo: ProviderAccount = { ...account, id: 'quark-main' };
    saveStoredProviderAccounts([account, demo]);
    const loaded = loadStoredProviderAccounts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('quark-1');
  });

  it('无数据时返回空数组', () => {
    expect(loadStoredProviderAccounts()).toEqual([]);
  });
});

describe('resolveThemeMode system + dark matchMedia', () => {
  it('system 且 prefers-color-scheme: dark -> dark', () => {
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(resolveThemeMode('system')).toBe('dark');
    spy.mockRestore();
  });
});

describe('SSR / 异常降级', () => {
  it('无 window 时安全降级', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(loadStoredProviderAccounts()).toEqual([]);
      expect(loadStoredThemeMode()).toBe('system');
      expect(loadStoredApiKey()).toBe('');
      expect(resolveThemeMode('system')).toBe('light');
      saveStoredProviderAccounts([account]);
      saveStoredApiKey('x');
      clearStoredApiKey();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('localStorage 读取抛错时降级返回默认值', () => {
    const getter = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(loadStoredApiKey()).toBe('');
      expect(loadStoredThemeMode()).toBe('system');
      expect(loadStoredProviderAccounts()).toEqual([]);
    } finally {
      getter.mockRestore();
    }
  });

  it('localStorage 写入 / 删除抛错时不抛出', () => {
    const setter = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveStoredApiKey('x')).not.toThrow();
    setter.mockRestore();
    const remover = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearStoredApiKey()).not.toThrow();
    remover.mockRestore();
  });
});
