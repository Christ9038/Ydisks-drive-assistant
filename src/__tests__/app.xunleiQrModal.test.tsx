//! App 根组件 XunleiQrModal 渲染测试：通过 mock useXunleiLogin 返回已设置的
//! xunleiQrAccount，触发 App.tsx 659-667 行的条件渲染分支。
//!
//! 该弹窗在真实 UI 下不可达：openXunleiAuthorization 仅被 XunleiQrModal 自身的
//! 「刷新二维码」按钮调用，而弹窗又依赖 openXunleiAuthorization 先设置 xunleiQrAccount，
//! 形成循环。此处用 mock 直接置位 xunleiQrAccount，验证 JSX 渲染不崩溃。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

const bridge = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => true),
  waitForNextPaint: vi.fn(() => Promise.resolve()),
  transferProviderShare: vi.fn(() => Promise.resolve({ shareUrl: 'https://share/x', savedFids: ['f1'], title: '资源' })),
  listProviderFolders: vi.fn(() => Promise.resolve([])),
  openProviderLogin: vi.fn(() => Promise.resolve()),
  openXunleiReviewWindow: vi.fn(() => Promise.resolve()),
  closeXunleiReviewWindow: vi.fn(() => Promise.resolve()),
  loginXunleiPassword: vi.fn(() => Promise.resolve()),
  captureProviderLogin: vi.fn(() => Promise.resolve({ hasCredential: true, loginName: 'login-user', cookieCount: 3 })),
  checkProviderLogin: vi.fn(() => Promise.resolve({ hasCredential: true, loginName: 'checked-user', cookieCount: 3 })),
  saveProviderCredential: vi.fn(() => Promise.resolve({ hasCredential: true, loginName: 'saved-user', cookieCount: 3 })),
  clearProviderCredentialInDb: vi.fn(() => Promise.resolve()),
  loadBusinessSettings: vi.fn(() => Promise.resolve({ transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: false })),
  importLegacyBusinessSettings: vi.fn(() => Promise.resolve({ transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: false })),
  saveTransferIntervals: vi.fn((value) => Promise.resolve(value)),
  configureBackendApiKey: vi.fn(() => Promise.resolve({ maxLinks: 100, usedLinks: 0, remainingLinks: 100, shortlinkAccessStatus: 'ACTIVE' })),
  clearBackendApiKey: vi.fn(() => Promise.resolve()),
  listProviderAccountsFromDb: vi.fn(() => Promise.resolve([])),
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

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

// mock useXunleiLogin：默认置位 xunleiQrAccount，触发 App.tsx 659-667 的 XunleiQrModal；
// 测试可调用 hook.mockReturnValue 切换为密码登录配置，覆盖 669-685 的 XunleiPasswordModal。
const xunleiStub = vi.hoisted(() => {
  const fn = () => {};
  // 稳定的 mock 引用，便于断言调用情况（clearAllMocks 仅清调用记录，引用不变）。
  const openXunleiAuthorization = vi.fn();
  const submitXunleiPasswordLogin = vi.fn();
  const openXunleiReviewUrl = vi.fn();
  const build = (overrides: Record<string, unknown> = {}) => ({
    xunleiQrAccount: undefined,
    xunleiQr: null,
    xunleiQrError: '',
    xunleiQrLoading: false,
    openXunleiAuthorization,
    openXunleiPasswordLogin: fn,
    resetXunleiQrModal: fn,
    setXunleiQrError: fn,
    xunleiLoginAccount: undefined,
    xunleiPassword: '',
    xunleiUsername: '',
    xunleiCreditKey: '',
    xunleiLoginError: '',
    xunleiLoginSaving: false,
    xunleiReviewUrl: '',
    xunleiRawReviewUrl: '',
    setXunleiUsername: fn,
    setXunleiPassword: fn,
    setXunleiCreditKey: fn,
    submitXunleiPasswordLogin,
    closeXunleiPasswordLogin: fn,
    clearXunleiLoginError: fn,
    openXunleiReviewUrl,
    ...overrides,
  });
  const qrAccount = {
    id: 'x1', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷主号',
    status: 'manual_required', loginName: '', purpose: '转存', lastChecked: '', hasCredential: false,
  };
  return {
    hook: vi.fn(() => build({ xunleiQrAccount: qrAccount })),
    build,
    qrAccount,
    openXunleiAuthorization,
    submitXunleiPasswordLogin,
    openXunleiReviewUrl,
  };
});
vi.mock('../hooks/useXunleiLogin', () => ({ useXunleiLogin: () => xunleiStub.hook() }));

import App from '../App';

describe('App - XunleiQrModal 条件渲染（659-667）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    xunleiStub.hook.mockReturnValue(xunleiStub.build({ xunleiQrAccount: xunleiStub.qrAccount }));
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.listProviderAccountsFromDb.mockResolvedValue([]);
    bridge.loadBatchesFromDb.mockResolvedValue([]);
    bridge.loadHistoryFromDb.mockResolvedValue([]);
    localStorage.clear();
  });

  it('xunleiQrAccount 存在时渲染迅雷扫码授权弹窗', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('dialog', { name: '迅雷扫码授权' })).toBeTruthy());
    expect(screen.getByText('迅雷主号')).toBeTruthy();
  });

  it('点击「刷新二维码」调用 openXunleiAuthorization（onRefresh L665）', async () => {
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: '迅雷扫码授权' });
    const refreshBtn = within(dialog).getByRole('button', { name: '刷新二维码' }) as HTMLButtonElement;
    // 刷新按钮未禁用（loading=false）
    expect(refreshBtn.disabled).toBe(false);
    fireEvent.click(refreshBtn);
    expect(xunleiStub.openXunleiAuthorization).toHaveBeenCalledWith(xunleiStub.qrAccount);
  });

  it('点击「立即检查」触发 handleProviderCheck（onSubmit L666）', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    // 二维码已生成时「立即检查」按钮启用
    xunleiStub.hook.mockReturnValue(
      xunleiStub.build({
        xunleiQrAccount: xunleiStub.qrAccount,
        xunleiQr: { qrcodeSvg: '<svg/>', userCode: 'UC1', expiresIn: 120 },
      }),
    );
    bridge.listProviderAccountsFromDb.mockResolvedValueOnce([{
      id: 'x1', provider: 'xunlei', status: 'manual_required', hasCredential: false,
      displayName: '迅雷主号', platformName: '迅雷网盘', loginName: '', purpose: '转存', lastChecked: '-',
    }] as never[]);
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: '迅雷扫码授权' });
    const checkBtn = within(dialog).getByRole('button', { name: '立即检查' }) as HTMLButtonElement;
    expect(checkBtn.disabled).toBe(false);
    fireEvent.click(checkBtn);
    // handleProviderCheck('x1') -> 账号无 cookie 且非待登录 -> captureProviderLogin
    await waitFor(() => expect(bridge.captureProviderLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' })));
  });
});

describe('App - XunleiPasswordModal 条件渲染（669-685）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.listProviderAccountsFromDb.mockResolvedValue([]);
    bridge.loadBatchesFromDb.mockResolvedValue([]);
    bridge.loadHistoryFromDb.mockResolvedValue([]);
    localStorage.clear();
  });

  it('点击「打开验证页」调用 openXunleiReviewUrl（onOpenReviewUrl L683）', async () => {
    xunleiStub.hook.mockReturnValue(
      xunleiStub.build({
        xunleiLoginAccount: {
          id: 'x2', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷密码登录',
          status: 'manual_required', loginName: '', purpose: '转存', lastChecked: '', hasCredential: false,
        },
        xunleiReviewUrl: 'https://review?deviceid=1',
      }),
    );
    render(<App />);
    const btn = await screen.findByRole('button', { name: '打开验证页' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(xunleiStub.openXunleiReviewUrl).toHaveBeenCalled();
  });

  it('点击「登录」调用 submitXunleiPasswordLogin（onSubmit L684）', async () => {
    xunleiStub.hook.mockReturnValue(
      xunleiStub.build({
        xunleiLoginAccount: {
          id: 'x2', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷密码登录',
          status: 'manual_required', loginName: '', purpose: '转存', lastChecked: '', hasCredential: false,
        },
        xunleiUsername: 'user',
        xunleiPassword: 'pass',
      }),
    );
    render(<App />);
    const btn = await screen.findByRole('button', { name: '登录' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(xunleiStub.submitXunleiPasswordLogin).toHaveBeenCalled();
  });
});
