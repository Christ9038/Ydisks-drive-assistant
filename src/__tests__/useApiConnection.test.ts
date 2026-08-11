import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../lib/bridge', () => ({
  loadBackendAssets: vi.fn(),
  loadBackendQuota: vi.fn(),
  loadBusinessSettings: vi.fn(),
  importLegacyBusinessSettings: vi.fn(),
  configureBackendApiKey: vi.fn(),
  clearBackendApiKey: vi.fn(),
  isTauriRuntime: vi.fn(() => false),
  waitForNextPaint: vi.fn().mockResolvedValue(undefined),
}));

import {
  clearBackendApiKey,
  configureBackendApiKey,
  isTauriRuntime,
  loadBackendAssets,
  loadBackendQuota,
  loadBusinessSettings,
  importLegacyBusinessSettings,
} from '../lib/bridge';
import { useApiConnection } from '../hooks/useApiConnection';
import type { ToastState } from '../hooks/useToast';

const quota = { maxLinks: 100, usedLinks: 1, remainingLinks: 99, shortlinkAccessStatus: 'ACTIVE' };
const assets = {
  quota,
  accounts: [{ id: 'y1', name: 'Ydisks' }],
  channels: [{ id: 'c1', name: 'Q群' }],
  domains: [{ domainName: 'd.com', status: 'ACTIVE' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  vi.mocked(loadBusinessSettings).mockResolvedValue({ transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: false });
  vi.mocked(importLegacyBusinessSettings).mockResolvedValue({ transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: false });
  vi.mocked(loadBackendQuota).mockResolvedValue(quota);
  vi.mocked(configureBackendApiKey).mockResolvedValue(quota);
  vi.mocked(loadBackendAssets).mockResolvedValue(assets);
  vi.mocked(clearBackendApiKey).mockResolvedValue();
});

const newHook = (setToast = (_: ToastState | null) => {}) => renderHook(() => useApiConnection(setToast));

describe('useApiConnection', () => {
  it('初始不持有 API Key 明文', () => {
    const { result } = newHook();
    expect(result.current.apiKey).toBe('');
    expect(result.current.hasApiKey).toBe(false);
    expect(result.current.apiConnectionStatus).toBe('failed');
    expect(loadBusinessSettings).not.toHaveBeenCalled();
  });

  it('输入仅作为临时草稿', () => {
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('my-key'));
    expect(result.current.apiKey).toBe('my-key');
    expect(result.current.apiConnectionStatus).toBe('idle');
    act(() => result.current.setApiKeyDraft(''));
    expect(result.current.apiConnectionStatus).toBe('failed');
  });

  it('空草稿且后端无 Key 时不检测', async () => {
    const { result } = newHook();
    await act(async () => result.current.detectApiKey());
    expect(configureBackendApiKey).not.toHaveBeenCalled();
    expect(loadBackendQuota).not.toHaveBeenCalled();
  });

  it('检测成功由 Rust 保存并立即清除前端明文', async () => {
    const toast = vi.fn();
    const { result } = newHook(toast);
    act(() => result.current.setApiKeyDraft(' k1 '));
    await act(async () => result.current.detectApiKey());
    expect(configureBackendApiKey).toHaveBeenCalledWith('k1');
    expect(result.current.apiKey).toBe('');
    expect(result.current.hasApiKey).toBe(true);
    expect(result.current.apiConnectionStatus).toBe('connected');
    expect(result.current.quotaState.usedLinks).toBe(1);
    await waitFor(() => expect(result.current.ydisksAccounts).toHaveLength(1));
    expect(toast).toHaveBeenCalledWith({ message: '后台已连接，剩余短链 99', tone: 'success' });
  });

  it('检测失败不保存配置并显示错误', async () => {
    vi.mocked(configureBackendApiKey).mockRejectedValue({ stage: 'backend', message: '无效 Key' });
    const toast = vi.fn();
    const { result } = newHook(toast);
    act(() => result.current.setApiKeyDraft('bad'));
    await act(async () => result.current.detectApiKey());
    expect(result.current.hasApiKey).toBe(false);
    expect(result.current.apiError).toContain('无效 Key');
    expect(toast).toHaveBeenCalledWith({ message: expect.stringContaining('无效 Key'), tone: 'danger' });
  });

  it('资产加载失败清空资产但不破坏连接状态', async () => {
    vi.mocked(loadBackendAssets).mockRejectedValue(new Error('失败'));
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('k1'));
    await act(async () => result.current.detectApiKey());
    await waitFor(() => expect(result.current.ydisksAccounts).toEqual([]));
    expect(result.current.apiConnectionStatus).toBe('connected');
  });

  it('清除 Key 只调用 Rust', async () => {
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('k1'));
    await act(async () => result.current.clearApiKeyImmediately());
    expect(clearBackendApiKey).toHaveBeenCalledTimes(1);
    expect(result.current.apiKey).toBe('');
    expect(result.current.hasApiKey).toBe(false);
  });

  it('额度乐观扣减忽略非正数', () => {
    const { result } = newHook();
    act(() => result.current.deductQuotaLocally(5));
    act(() => result.current.deductQuotaLocally(0));
    act(() => result.current.deductQuotaLocally(-3));
    expect(result.current.quotaState.usedLinks).toBe(5);
  });

  it('桌面启动从 Rust 脱敏设置恢复连接', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(loadBusinessSettings).mockResolvedValue({ transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: true });
    const { result } = newHook();
    await waitFor(() => expect(result.current.apiConnectionStatus).toBe('connected'));
    expect(result.current.hasApiKey).toBe(true);
    expect(result.current.apiKey).toBe('');
    expect(loadBackendQuota).toHaveBeenCalledTimes(1);
    expect(loadBackendAssets).toHaveBeenCalledTimes(1);
  });

  it('桌面启动把旧前端业务配置一次性迁移到 Rust 并删除旧键', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    localStorage.setItem('ydisks.transfer.apiKey.v1', 'old-key');
    localStorage.setItem('ydisks.transfer.intervals.v1', JSON.stringify({ quark: 3, baidu: 5, xunlei: 6 }));
    vi.mocked(importLegacyBusinessSettings).mockResolvedValue({
      transferIntervals: { quark: 3, baidu: 5, xunlei: 6 }, hasApiKey: true,
    });
    const { result } = newHook();
    await waitFor(() => expect(result.current.hasApiKey).toBe(true));
    expect(importLegacyBusinessSettings).toHaveBeenCalledWith('old-key', { quark: 3, baidu: 5, xunlei: 6 });
    expect(localStorage.getItem('ydisks.transfer.apiKey.v1')).toBeNull();
    expect(localStorage.getItem('ydisks.transfer.intervals.v1')).toBeNull();
  });

  it('后端已配置时同步额度，失败保留乐观值', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(loadBusinessSettings).mockResolvedValue({ transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: true });
    const { result } = newHook();
    await waitFor(() => expect(result.current.hasApiKey).toBe(true));
    vi.mocked(loadBackendQuota).mockResolvedValue({ ...quota, usedLinks: 50 });
    await act(async () => result.current.syncQuotaFromBackend());
    expect(result.current.quotaState.usedLinks).toBe(50);
    act(() => result.current.deductQuotaLocally(7));
    vi.mocked(loadBackendQuota).mockRejectedValue(new Error('网络错误'));
    await act(async () => result.current.syncQuotaFromBackend());
    expect(result.current.quotaState.usedLinks).toBe(57);
  });
});
