import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, render, act, waitFor } from '@testing-library/react';
import { StrictMode, createElement } from 'react';

vi.mock('../lib/bridge', () => ({
  loadBackendAssets: vi.fn(),
  loadBackendQuota: vi.fn(),
  isTauriRuntime: vi.fn(() => false),
  waitForNextPaint: vi.fn().mockResolvedValue(undefined),
}));

const storageApi = vi.hoisted(() => ({
  loadStoredApiKey: vi.fn(() => ''),
  saveStoredApiKey: vi.fn(),
  clearStoredApiKey: vi.fn(),
}));
vi.mock('../lib/storage', () => storageApi);

import { loadBackendAssets, loadBackendQuota, isTauriRuntime } from '../lib/bridge';
import { loadStoredApiKey, saveStoredApiKey, clearStoredApiKey } from '../lib/storage';
import { useApiConnection } from '../hooks/useApiConnection';
import type { ToastState } from '../hooks/useToast';
import type { RustBackendAssetsSnapshot } from '../lib/types';

const assets: RustBackendAssetsSnapshot = {
  quota: { maxLinks: 100, usedLinks: 1, remainingLinks: 99, shortlinkAccessStatus: 'ACTIVE' },
  accounts: [{ id: 'y1', name: 'Ydisks' }],
  channels: [{ id: 'c1', name: 'Q群' }],
  domains: [{ domainName: 'd.com', status: 'ACTIVE' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  storageApi.loadStoredApiKey.mockReturnValue('');
  vi.mocked(loadBackendAssets).mockReset();
  vi.mocked(loadBackendQuota).mockReset();
  vi.mocked(loadBackendAssets).mockResolvedValue(assets);
  vi.mocked(loadBackendQuota).mockResolvedValue({ maxLinks: 100, usedLinks: 1, remainingLinks: 99, shortlinkAccessStatus: 'ACTIVE' });
});

const newHook = (setToast = (_: ToastState | null) => {}) => renderHook(({ toast }) => useApiConnection(toast), { initialProps: { toast: setToast } });

describe('useApiConnection', () => {
  it('无存储 Key 时初始为 failed', () => {
    const { result } = newHook();
    expect(result.current.apiKey).toBe('');
    expect(result.current.apiConnectionStatus).toBe('failed');
  });

  it('有存储 Key 但非桌面端时初始为 idle 且不自动检测', () => {
    storageApi.loadStoredApiKey.mockReturnValue('stored-key');
    const { result } = newHook();
    expect(result.current.apiConnectionStatus).toBe('idle');
    expect(loadBackendQuota).not.toHaveBeenCalled();
  });

  it('setApiKeyDraft 空 -> failed；非空 -> idle', () => {
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('my-key'));
    expect(result.current.apiKey).toBe('my-key');
    expect(result.current.apiConnectionStatus).toBe('idle');
    act(() => result.current.setApiKeyDraft(''));
    expect(result.current.apiConnectionStatus).toBe('failed');
  });

  it('detectApiKey 空 Key 直接 failed', async () => {
    const { result } = newHook();
    await act(async () => {
      await result.current.detectApiKey();
    });
    expect(result.current.apiConnectionStatus).toBe('failed');
  });

  it('detectApiKey 成功：连接、保存 Key、额度、toast、拉取资产', async () => {
    const setToast = vi.fn();
    const { result } = newHook(setToast);
    act(() => result.current.setApiKeyDraft('k1'));
    await act(async () => {
      await result.current.detectApiKey();
    });
    expect(result.current.apiConnectionStatus).toBe('connected');
    expect(result.current.apiKey).toBe('k1');
    expect(saveStoredApiKey).toHaveBeenCalledWith('k1');
    expect(result.current.quotaState).toEqual({ maxLinks: 100, usedLinks: 1, shortlinkAccessStatus: 'ACTIVE' });
    expect(setToast).toHaveBeenCalledWith({ message: '后台已连接，剩余短链 99', tone: 'success' });
    await waitFor(() => expect(result.current.ydisksAccounts).toHaveLength(1));
    expect(result.current.domainOptions).toHaveLength(1);
    expect(result.current.shortlinkOptions).toHaveLength(1);
  });

  it('detectApiKey 失败：failed + 错误 + danger toast', async () => {
    vi.mocked(loadBackendQuota).mockRejectedValue({ stage: 'backend', message: '无效 Key' });
    const setToast = vi.fn();
    const { result } = newHook(setToast);
    act(() => result.current.setApiKeyDraft('bad'));
    await act(async () => {
      await result.current.detectApiKey();
    });
    expect(result.current.apiConnectionStatus).toBe('failed');
    expect(result.current.apiError).toContain('无效 Key');
    expect(setToast).toHaveBeenCalledWith({ message: expect.stringContaining('无效 Key'), tone: 'danger' });
  });

  it('loadBackendAssets 失败时清空资产', async () => {
    vi.mocked(loadBackendAssets).mockRejectedValue({ message: '资产拉取失败' });
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('k1'));
    await act(async () => {
      await result.current.detectApiKey();
    });
    await waitFor(() => expect(result.current.ydisksAccounts).toHaveLength(0));
    expect(result.current.domainOptions).toHaveLength(0);
  });

  it('clearApiKeyImmediately 清除 Key 与状态', () => {
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('k1'));
    act(() => result.current.clearApiKeyImmediately());
    expect(clearStoredApiKey).toHaveBeenCalled();
    expect(result.current.apiKey).toBe('');
    expect(result.current.apiConnectionStatus).toBe('failed');
    expect(result.current.apiError).toBe('');
  });

  it('deductQuotaLocally 正数累加 usedLinks，非正数无副作用', () => {
    const { result } = newHook();
    act(() => result.current.deductQuotaLocally(5));
    expect(result.current.quotaState.usedLinks).toBe(5);
    act(() => result.current.deductQuotaLocally(0));
    expect(result.current.quotaState.usedLinks).toBe(5);
    act(() => result.current.deductQuotaLocally(-3));
    expect(result.current.quotaState.usedLinks).toBe(5);
  });

  it('syncQuotaFromBackend 成功覆盖额度', async () => {
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('k1'));
    vi.mocked(loadBackendQuota).mockResolvedValue({ maxLinks: 200, usedLinks: 50, remainingLinks: 150, shortlinkAccessStatus: 'ACTIVE' });
    await act(async () => {
      await result.current.syncQuotaFromBackend();
    });
    expect(result.current.quotaState).toEqual({ maxLinks: 200, usedLinks: 50, shortlinkAccessStatus: 'ACTIVE' });
  });

  it('syncQuotaFromBackend 失败时静默（保留本地值）', async () => {
    const { result } = newHook();
    act(() => result.current.setApiKeyDraft('k1'));
    act(() => result.current.deductQuotaLocally(7));
    vi.mocked(loadBackendQuota).mockRejectedValue({ message: '网络错误' });
    await act(async () => {
      await result.current.syncQuotaFromBackend();
    });
    // 保留本地乐观值
    expect(result.current.quotaState.usedLinks).toBe(7);
  });

  it('syncQuotaFromBackend 空 Key 时直接返回', async () => {
    const { result } = newHook();
    await act(async () => {
      await result.current.syncQuotaFromBackend();
    });
    expect(loadBackendQuota).not.toHaveBeenCalled();
  });

  it('桌面端启动且有存储 Key 时自动检测', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    storageApi.loadStoredApiKey.mockReturnValue('stored-key');
    const { result } = newHook();
    await waitFor(() => expect(loadBackendQuota).toHaveBeenCalled());
    expect(result.current.apiKey).toBe('stored-key');
  });

  it('StrictMode 双调用时自动检测仅执行一次（ref 守卫）', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    storageApi.loadStoredApiKey.mockReturnValue('stored-key');
    // renderHook 不会触发 StrictMode 双调用，改用 render 渲染真实组件以触发双调用；
    // ref 守卫（167-169）确保 detectApiKey 仅执行一次。
    const Probe = (props: { toast: (t: ToastState | null) => void }) => {
      useApiConnection(props.toast);
      return null;
    };
    render(createElement(StrictMode, null, createElement(Probe, { toast: () => {} })));
    await waitFor(() => expect(loadBackendAssets).toHaveBeenCalledTimes(1));
    // 双调用下若守卫失效会调用两次；这里断言恰好一次。
    expect(loadBackendAssets).toHaveBeenCalledTimes(1);
  });
});
