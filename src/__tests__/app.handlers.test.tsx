//! App 根组件 handler 边界测试：通过 mock SettingsPage 捕获 onProvider* 回调，
//! 直接以 UI 不会产生的入参（空名 / 不存在 ID / 人工构造的异常状态账号）调用，
//! 覆盖 handleProviderAdd/Delete/Login/Check 中的防御性守卫分支。
//!
//! 这些分支在真实 UI 下不可达：SettingsPage/ProviderCard 的 effectiveStatus 门控
//! 会阻止「检测」按钮出现在无 cookie 或 manual_required 账号上，且 UI 只传已存在账号 ID。
//! 此处绕过 UI 直接调用 App 暴露给 SettingsPage 的 handler，验证守卫行为。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

const bridge = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => true),
  waitForNextPaint: vi.fn(() => Promise.resolve()),
  transferProviderShare: vi.fn(() => Promise.resolve({ shareUrl: 'https://share/x', savedFids: ['f1'], title: '资源' })),
  listProviderFolders: vi.fn(() => Promise.resolve([])),
  openProviderLogin: vi.fn(() => Promise.resolve()),
  openXunleiReviewWindow: vi.fn(() => Promise.resolve()),
  closeXunleiReviewWindow: vi.fn(() => Promise.resolve()),
  loginXunleiPassword: vi.fn(() => Promise.resolve()),
  captureProviderLogin: vi.fn(() => Promise.resolve({ cookie: 'ck-new', loginName: 'login-user', cookieCount: 3 })),
  checkProviderLogin: vi.fn(() => Promise.resolve({ cookie: 'ck-checked', loginName: 'checked-user', cookieCount: 3 })),
  listProviderAccountsFromDb: vi.fn(() => Promise.resolve([] as ProviderAccount[])),
  upsertProviderAccountToDb: vi.fn(() => Promise.resolve()),
  deleteProviderAccountFromDb: vi.fn(() => Promise.resolve()),
  importLegacyAccountsToDb: vi.fn(() => Promise.resolve(0)),
  saveBatchToDb: vi.fn(() => Promise.resolve()),
  loadBatchesFromDb: vi.fn(() => Promise.resolve([])),
  deleteBatchFromDb: vi.fn(() => Promise.resolve()),
  saveHistoryToDb: vi.fn(() => Promise.resolve()),
  loadHistoryFromDb: vi.fn(() => Promise.resolve([])),
  parseImport: vi.fn(() => Promise.resolve({ accepted: [], filtered: 0 })),
  createBackendLinks: vi.fn(() => Promise.resolve({ originalLinkId: 'L1', shortLinks: [] })),
  loadBackendAssets: vi.fn(() => Promise.resolve({
    quota: { maxLinks: 100, usedLinks: 0, remainingLinks: 100, shortlinkAccessStatus: 'ACTIVE' },
    accounts: [], channels: [], domains: [],
  })),
  loadBackendQuota: vi.fn(() => Promise.resolve({ maxLinks: 100, usedLinks: 0, remainingLinks: 100, shortlinkAccessStatus: 'ACTIVE' })),
  openLogDir: vi.fn(() => Promise.resolve('/logs')),
  downloadHistoryCsv: vi.fn(() => Promise.resolve('/out/history.csv')),
}));
vi.mock('../lib/bridge', () => bridge);

const eventApi = vi.hoisted(() => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('@tauri-apps/api/event', () => eventApi);

// 捕获 App 传给 SettingsPage 的 handler。每次渲染刷新。
const captured = vi.hoisted(() => ({ current: {} as Record<string, (...args: unknown[]) => void> }));
vi.mock('../pages/SettingsPage', () => ({
  SettingsPage: (props: Record<string, unknown>) => {
    captured.current = {
      onProviderAdd: props.onProviderAdd as (...a: unknown[]) => void,
      onProviderDelete: props.onProviderDelete as (...a: unknown[]) => void,
      onProviderLogin: props.onProviderLogin as (...a: unknown[]) => void,
      onProviderCheck: props.onProviderCheck as (...a: unknown[]) => void,
    };
    return null;
  },
}));

import App from '../App';
import type { ProviderAccount } from '../types';

const quarkAccount = (over: Partial<ProviderAccount>): ProviderAccount => ({
  id: 'a1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '账号',
  status: 'connected',
  loginName: 'u',
  purpose: '转存',
  lastChecked: '刚刚',
  cookie: 'ck',
  ...over,
});

const renderApp = () => render(<App />);

const gotoSettings = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
  await waitFor(() => expect(captured.current.onProviderCheck).toBeTypeOf('function'));
  return captured.current;
};

describe('App handler 防御性守卫（mock SettingsPage 捕获）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.listProviderAccountsFromDb.mockResolvedValue([]);
    bridge.loadBatchesFromDb.mockResolvedValue([]);
    bridge.loadHistoryFromDb.mockResolvedValue([]);
    localStorage.clear();
  });

  it('handleProviderAdd 空名直接返回（347-348）', async () => {
    renderApp();
    const h = await gotoSettings();
    h.onProviderAdd('quark', '   ');
    // 无账号新增、无持久化
    expect(bridge.upsertProviderAccountToDb).not.toHaveBeenCalled();
    expect(bridge.openProviderLogin).not.toHaveBeenCalled();
  });

  it('handleProviderDelete 不存在 ID 直接返回（375-376）', async () => {
    renderApp();
    const h = await gotoSettings();
    h.onProviderDelete('does-not-exist');
    expect(bridge.deleteProviderAccountFromDb).not.toHaveBeenCalled();
  });

  it('handleProviderLogin 不存在 ID 直接返回（386-387）', async () => {
    renderApp();
    const h = await gotoSettings();
    await h.onProviderLogin('does-not-exist');
    expect(bridge.openProviderLogin).not.toHaveBeenCalled();
  });

  it('handleProviderCheck 不存在 ID 直接返回（417-418）', async () => {
    renderApp();
    const h = await gotoSettings();
    await h.onProviderCheck('does-not-exist');
    expect(bridge.checkProviderLogin).not.toHaveBeenCalled();
    expect(bridge.captureProviderLogin).not.toHaveBeenCalled();
  });

  it('handleProviderCheck 迅雷 manual_required+awaitingLogin -> 密码登录（424-431）', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      quarkAccount({
        id: 'x1',
        provider: 'xunlei',
        platformName: '迅雷网盘',
        displayName: '迅雷待登录',
        status: 'manual_required',
        cookie: '',
        pendingReason: '请在迅雷官方窗口完成扫码授权',
      }),
    ]);
    renderApp();
    const h = await gotoSettings();
    // account.provider === 'xunlei' && isAwaitingProviderLogin(account) -> openXunleiPasswordLogin + 提前 return
    await act(async () => {
      await h.onProviderCheck('x1');
    });
    // 提前返回：未走到 check/capture 分支
    expect(bridge.checkProviderLogin).not.toHaveBeenCalled();
    expect(bridge.captureProviderLogin).not.toHaveBeenCalled();
  });

  it('handleProviderCheck connected 无 cookie -> captureProviderLogin（435-436）', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      quarkAccount({ id: 'nc1', status: 'connected', cookie: '' }),
    ]);
    renderApp();
    const h = await gotoSettings();
    await act(async () => {
      await h.onProviderCheck('nc1');
    });
    // account.cookie 为空 -> account.cookie && !awaitingLogin 为 false -> captureProviderLogin
    expect(bridge.captureProviderLogin).toHaveBeenCalledTimes(1);
    expect(bridge.checkProviderLogin).not.toHaveBeenCalled();
  });
});
