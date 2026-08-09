import { describe, it, expect } from 'vitest';
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
