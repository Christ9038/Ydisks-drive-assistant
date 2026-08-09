//! App 根组件 XunleiQrModal 渲染测试：通过 mock useXunleiLogin 返回已设置的
//! xunleiQrAccount，触发 App.tsx 659-667 行的条件渲染分支。
//!
//! 该弹窗在真实 UI 下不可达：openXunleiAuthorization 仅被 XunleiQrModal 自身的
//! 「刷新二维码」按钮调用，而弹窗又依赖 openXunleiAuthorization 先设置 xunleiQrAccount，
//! 形成循环。此处用 mock 直接置位 xunleiQrAccount，验证 JSX 渲染不崩溃。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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

// mock useXunleiLogin：直接置位 xunleiQrAccount，其余返回安全默认值。
const xunleiStub = vi.hoisted(() => {
  const fn = () => {};
  return {
    hook: () => ({
      xunleiQrAccount: {
        id: 'x1', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷主号',
        status: 'manual_required', loginName: '', purpose: '转存', lastChecked: '', cookie: undefined,
      },
      xunleiQr: null,
      xunleiQrError: '',
      xunleiQrLoading: false,
      openXunleiAuthorization: fn,
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
      submitXunleiPasswordLogin: fn,
      closeXunleiPasswordLogin: fn,
      clearXunleiLoginError: fn,
      openXunleiReviewUrl: fn,
    }),
  };
});
vi.mock('../hooks/useXunleiLogin', () => ({ useXunleiLogin: () => xunleiStub.hook() }));

import App from '../App';

describe('App - XunleiQrModal 条件渲染（659-667）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
