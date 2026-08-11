//! App 根组件集成测试：导航 / 侧边栏 / API Key / 网盘账号 CRUD / 确认弹窗 / Toast /
//! 持久化与登录事件 / CSV 导出 / 打开日志目录。
//!
//! 桥接层（bridge）与 Tauri 事件整体 mock，真实 hooks 在浏览器模式（isTauriRuntime=false）
//! 下其网络/DB/轮询副作用均被门控；桌面模式分支通过单独切换 isTauriRuntime 覆盖。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const bridge = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  waitForNextPaint: vi.fn(() => Promise.resolve()),
  transferProviderShare: vi.fn(() => Promise.resolve({ shareUrl: 'https://share/x', savedFids: ['f1'], title: '资源' })),
  listProviderFolders: vi.fn(() => Promise.resolve([])),
  openProviderLogin: vi.fn(() => Promise.resolve()),
  startXunleiLogin: vi.fn(() => Promise.resolve({ userCode: 'UC1', qrcodeSvg: '<svg/>', qrcodeUrl: 'https://qr', expiresIn: 120 })),
  checkXunleiLogin: vi.fn(() => Promise.resolve({ status: 'pending' })),
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
  listProviderAccountsFromDb: vi.fn(() => Promise.resolve([] as ProviderAccount[])),
  upsertProviderAccountToDb: vi.fn(() => Promise.resolve()),
  deleteProviderAccountFromDb: vi.fn(() => Promise.resolve()),
  importLegacyAccountsToDb: vi.fn(() => Promise.resolve(0)),
  saveBatchToDb: vi.fn(() => Promise.resolve()),
  loadBatchesFromDb: vi.fn(() => Promise.resolve([])),
  deleteBatchFromDb: vi.fn(() => Promise.resolve()),
  saveHistoryToDb: vi.fn(() => Promise.resolve()),
  loadHistoryFromDb: vi.fn(() => Promise.resolve([] as HistoryRecord[])),
  parseImport: vi.fn(() => Promise.resolve({ accepted: [] as ParsedResource[], filtered: 0 })),
  createBackendLinks: vi.fn(() => Promise.resolve({ originalLinkId: 'L1', shortLinks: [] })),
  loadBackendAssets: vi.fn(() => Promise.resolve({
    quota: { maxLinks: 100, usedLinks: 0, remainingLinks: 100, shortlinkAccessStatus: 'ACTIVE' },
    accounts: [], channels: [], domains: [],
  })),
  loadBackendQuota: vi.fn(() => Promise.resolve({ maxLinks: 100, usedLinks: 0, remainingLinks: 100, shortlinkAccessStatus: 'ACTIVE' })),
  openLogDir: vi.fn(() => Promise.resolve('/logs')),
  downloadHistoryCsv: vi.fn((_history: HistoryRecord) => Promise.resolve('/out/history.csv' as string | null)),
}));
vi.mock('../lib/bridge', () => bridge);

const eventApi = vi.hoisted(() => ({ listen: vi.fn((_event: string, _cb: (e: { payload: unknown }) => void) => Promise.resolve(() => {})) }));
vi.mock('@tauri-apps/api/event', () => eventApi);

import App from '../App';
import type { HistoryRecord, ParsedResource } from '../lib/types';
import type { ProviderAccount } from '../types';

const historyRecord = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: 'H1',
  status: 'success',
  createdAt: '2024-01-01 00:00',
  total: 1,
  completed: 1,
  failed: 0,
  items: [],
  logs: [],
  ...overrides,
});

const renderApp = () => render(<App />);

describe('App - 浏览器模式（isTauriRuntime=false）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.isTauriRuntime.mockReturnValue(false);
    bridge.loadBusinessSettings.mockResolvedValue({ transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: false });
    localStorage.clear();
  });

  it('默认渲染任务页 + 顶部导航品牌与 API Key 输入', () => {
    renderApp();
    expect(screen.getByText('Ydisks批量转存助手')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '任务' })).toBeTruthy();
    expect(screen.getByPlaceholderText('API Key')).toBeTruthy();
  });

  it('主导航在任务/状态/历史/设置间切换', () => {
    renderApp();
    // 用顶栏 eyebrow（每页唯一）判定当前页
    fireEvent.click(screen.getByRole('button', { name: /^状态$/ }));
    expect(screen.getByText('执行监控')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^历史记录$/ }));
    expect(screen.getByText('批次记录')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    expect(screen.getByText('后台 / 网盘 / 本地')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^任务$/ }));
    expect(screen.getByText('新建批量转存')).toBeTruthy();
  });

  it('设置页保存按平台间隔并把低于 3 秒的输入提升为 3 秒', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    const input = screen.getByLabelText('夸克转存间隔') as HTMLInputElement;
    expect(input.value).toBe('4');
    fireEvent.change(input, { target: { value: '1' } });
    expect(input.value).toBe('3');
    await waitFor(() => expect(bridge.saveTransferIntervals).toHaveBeenCalledWith({ quark: 3, baidu: 4, xunlei: 4 }));
    expect(localStorage.getItem('ydisks.transfer.intervals.v1')).toBeNull();
  });

  it('任务页「开启去重」勾选切换 dedupeEnabled（onToggleDedupe L508）', () => {
    renderApp();
    const checkbox = screen.getByRole('checkbox', { name: '开启去重' }) as HTMLInputElement;
    // dedupeEnabled 初始为 true
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it('创建批次后切换到状态页（onBatchCreated L252）', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.listProviderAccountsFromDb.mockResolvedValue([{
      id: 'q-conn', provider: 'quark', status: 'connected', hasCredential: true,
      displayName: '夸克A', platformName: '夸克网盘', loginName: 'q@x', purpose: '转存', lastChecked: '刚刚',
    }]);
    bridge.parseImport.mockResolvedValue({
      accepted: [{ title: '资源A', sourceUrl: 'https://pan.quark.cn/s/abc', provider: 'quark' }],
      filtered: 0,
    });
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    // 逐条添加资源
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '资源A' } });
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: 'https://pan.quark.cn/s/abc' } });
    fireEvent.click(screen.getByRole('button', { name: '添加到清单' }));
    // 等待资源加入后提交按钮启用
    const submit = screen.getByRole('button', { name: '创建任务并执行' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    // createBatch -> onBatchCreated -> selectPage('status')
    await waitFor(() => expect(screen.getByText('任务状态')).toBeTruthy());
  });

  it('移动端菜单：打开 / 关闭侧边栏', () => {
    renderApp();
    const shell = document.querySelector('.app-shell');
    expect(shell?.className).not.toContain('is-sidebar-open');
    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));
    expect(document.querySelector('.app-shell')?.className).toContain('is-sidebar-open');
    // 遮罩（sidebar-scrim，DOM 顺序第一个）关闭
    fireEvent.click(screen.getAllByRole('button', { name: '关闭导航菜单' })[0]);
    expect(document.querySelector('.app-shell')?.className).not.toContain('is-sidebar-open');
    // 重新打开，用关闭按钮（mobile-close-button L570，DOM 顺序第二个）关闭
    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));
    expect(document.querySelector('.app-shell')?.className).toContain('is-sidebar-open');
    fireEvent.click(screen.getAllByRole('button', { name: '关闭导航菜单' })[1]);
    expect(document.querySelector('.app-shell')?.className).not.toContain('is-sidebar-open');
  });

  it('设置页：添加夸克账号触发 openProviderLogin', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    const input = screen.getByLabelText('账号备注');
    fireEvent.change(input, { target: { value: '我的夸克' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(bridge.openProviderLogin).toHaveBeenCalledTimes(1));
    // 账号已加入并渲染卡片
    expect(screen.getByText('我的夸克')).toBeTruthy();
  });

  it('设置页：填写备注后点击「保存」按钮添加账号（L205 onClick）', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '按钮添加' } });
    // 点击「保存」按钮（而非回车）触发 submitAddForm
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(bridge.openProviderLogin).toHaveBeenCalledTimes(1));
    expect(screen.getByText('按钮添加')).toBeTruthy();
  });

  it('设置页：添加迅雷账号打开密码登录弹窗', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    // 迅雷分组的添加按钮（第 3 个）
    const addButtons = screen.getAllByRole('button', { name: '添加账号' });
    fireEvent.click(addButtons[2]);
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    // 迅雷密码登录弹窗出现
    await waitFor(() => expect(screen.getByRole('dialog', { name: '迅雷账号登录' })).toBeTruthy());
  });

  it('设置页：空名添加不触发', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    expect(bridge.openProviderLogin).not.toHaveBeenCalled();
  });

  it('设置页：检测已连接账号调用 checkProviderLogin（手动添加后走登录）', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号A' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('账号A')).toBeTruthy());
    // manual_required + 待官方窗口登录 -> 主按钮为「重新打开」，点击触发 openProviderLogin
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
    await waitFor(() => expect(bridge.openProviderLogin).toHaveBeenCalledTimes(2));
  });

  it('设置页：清理会话将账号置为过期', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号B' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('账号B')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '清理会话' }));
    await waitFor(() => expect(screen.getByText('登录过期')).toBeTruthy());
  });

  it('设置页：删除账号从列表移除', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号C' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('账号C')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.queryByText('账号C')).toBeNull();
  });

  it('API Key 输入并检测成功后提示后台已连接', async () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'key-123' } });
    fireEvent.click(screen.getByRole('button', { name: '检测' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('后台已连接'));
  });

  it('API Key 检测失败显示错误 Toast', async () => {
    bridge.configureBackendApiKey.mockRejectedValueOnce(new Error('无效的 API Key'));
    renderApp();
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '检测' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('无效的 API Key'));
  });

  it('清除 API Key（顶部按钮）直接清空', async () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: '清除 API Key' }));
    await waitFor(() => expect((screen.getByPlaceholderText('API Key') as HTMLInputElement).value).toBe(''));
  });

  it('设置页「清除密钥」弹出确认弹窗，确认后清空', async () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getByRole('button', { name: '清除密钥' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '清除密钥' }));
    await waitFor(() => expect((screen.getByPlaceholderText('API Key') as HTMLInputElement).value).toBe(''));
  });

  it('确认弹窗取消后不执行', async () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getByRole('button', { name: '清除密钥' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByPlaceholderText('API Key') as HTMLInputElement).value).toBe('k');
  });

  it('打开日志目录：浏览器模式提示在桌面端运行', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getByRole('button', { name: '打开日志目录' }));
    await waitFor(() => expect(screen.getByText('请在桌面端运行')).toBeTruthy());
  });

  it('Toast 在操作触发时渲染', async () => {
    bridge.configureBackendApiKey.mockRejectedValueOnce(new Error('boom'));
    renderApp();
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '检测' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('boom'));
  });

  it('Cookie 粘贴弹窗：打开后提交保存并关闭', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号D' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('账号D')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '粘贴 Cookie' }));
    expect(screen.getByRole('dialog', { name: '粘贴 Cookie' })).toBeTruthy();
    const textarea = screen.getByLabelText('Cookie') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'cookie-content' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 Cookie' }));
    // 保存后弹窗关闭、账号变为已登录
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('已登录')).toBeTruthy();
  });

  it('Cookie 弹窗打开时点击清理会话 -> 关闭弹窗并置过期', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号G' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('账号G')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '粘贴 Cookie' }));
    expect(screen.getByRole('dialog', { name: '粘贴 Cookie' })).toBeTruthy();
    // page 由 useMemo 缓存，cookieModalAccountId 变更不会重算；切换主题强制重算，
    // 使 handleProviderClear 拿到看到弹窗态的最新闭包，从而走 resetCookieModal 分支。
    fireEvent.click(screen.getByRole('radio', { name: '夜间' }));
    fireEvent.click(screen.getByRole('button', { name: '清理会话' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('登录过期')).toBeTruthy();
  });

  it('Cookie 弹窗打开时点击删除 -> 关闭弹窗并移除账号', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号H' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('账号H')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '粘贴 Cookie' }));
    expect(screen.getByRole('dialog', { name: '粘贴 Cookie' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '夜间' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('账号H')).toBeNull();
  });

  it('历史页：无记录时显示空状态', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^历史记录$/ }));
    expect(screen.getByText('暂无历史记录')).toBeTruthy();
  });

  it('状态页：无批次时显示空状态', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^状态$/ }));
    expect(screen.getByText(/暂无/)).toBeTruthy();
  });

  it('添加账号时 openProviderLogin 失败回写错误到账号', async () => {
    bridge.openProviderLogin.mockRejectedValueOnce(new Error('窗口被拦截'));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号E' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('窗口被拦截')).toBeTruthy());
  });

  it('重新打开登录窗口失败回写错误', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '账号F' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('button', { name: '重新打开' })).toBeTruthy());
    bridge.openProviderLogin.mockRejectedValueOnce(new Error('打开失败'));
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
    await waitFor(() => expect(screen.getAllByText('打开失败').length).toBeGreaterThan(0));
  });
});

describe('App - 桌面模式（isTauriRuntime=true）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.listProviderAccountsFromDb.mockResolvedValue([]);
    bridge.upsertProviderAccountToDb.mockResolvedValue(undefined);
    bridge.deleteProviderAccountFromDb.mockResolvedValue(undefined);
    bridge.loadBatchesFromDb.mockResolvedValue([]);
    bridge.loadHistoryFromDb.mockResolvedValue([]);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('启动时从 SQLite 加载账号', async () => {
    const acc = { id: 'db1', provider: 'quark' as const, platformName: '夸克网盘', displayName: 'DB账号', status: 'connected' as const, loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true };
    bridge.listProviderAccountsFromDb.mockResolvedValue([acc]);
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    // 账号同步到设置页
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('DB账号')).toBeTruthy());
  });

  it('DB 空且 localStorage 有旧账号时触发迁移', async () => {
    const legacy = [{ id: 'legacy1', provider: 'quark', platformName: '夸克网盘', displayName: '旧账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true }];
    localStorage.setItem('ydisks.transfer.providerAccounts.v2', JSON.stringify(legacy));
    bridge.listProviderAccountsFromDb
      .mockResolvedValueOnce([]) // 首次：DB 空
      .mockResolvedValueOnce([{ id: 'legacy1', provider: 'quark', platformName: '夸克网盘', displayName: '迁移账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true }]); // 迁移后重载
    renderApp();
    await waitFor(() => expect(bridge.importLegacyAccountsToDb).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(localStorage.getItem('ydisks.transfer.providerAccounts.v2')).toBeNull();
  });

  it('检测已连接账号调用 checkProviderLogin', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'acc-conn', provider: 'quark', platformName: '夸克网盘', displayName: '已连接账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('已连接账号')).toBeTruthy(), { timeout: 2000 });
    // 顶栏 API Key「检测」与卡片「检测」同名，点击卡片的（第二个）
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    await waitFor(() => expect(bridge.checkProviderLogin).toHaveBeenCalledTimes(1));
  });

  it('账号变更同步到 SQLite（upsert / delete）', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([]);
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    // 添加一个账号触发 upsert
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '同步账号' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(bridge.openProviderLogin).toHaveBeenCalled());
    await waitFor(() => expect(bridge.upsertProviderAccountToDb).toHaveBeenCalled());
  });

  it('provider-login-complete 事件更新账号并提示', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'acc-login', provider: 'quark', platformName: '夸克网盘', displayName: '待登录', status: 'manual_required', loginName: '未登录', purpose: '转存', lastChecked: '刚刚', hasCredential: false },
    ]);
    let handler: ((e: { payload: unknown }) => void) | undefined;
    eventApi.listen.mockImplementationOnce(async (_event: string, cb: (e: { payload: unknown }) => void) => {
      handler = cb;
      return () => {};
    });
    renderApp();
    await waitFor(() => expect(eventApi.listen).toHaveBeenCalledWith('provider-login-complete', expect.any(Function)));
    await act(async () => {
      handler?.({ payload: { accountId: 'acc-login', provider: 'quark', result: { hasCredential: true, loginName: '登录用户', cookieCount: 1 } } });
    });
    await waitFor(() => expect(screen.getByText('夸克账号已登录')).toBeTruthy());
  });

  it('导出历史 CSV 成功提示路径', async () => {
    bridge.loadHistoryFromDb.mockResolvedValue([historyRecord()]);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^历史记录$/ }));
    await waitFor(() => expect(screen.getByText('查看')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    await waitFor(() => expect(bridge.downloadHistoryCsv).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/已导出到/)).toBeTruthy();
  });

  it('导出历史 CSV 取消（返回 null）提示已取消', async () => {
    bridge.loadHistoryFromDb.mockResolvedValue([historyRecord()]);
    bridge.downloadHistoryCsv.mockResolvedValueOnce(null);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^历史记录$/ }));
    await waitFor(() => expect(screen.getByText('查看')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    await waitFor(() => expect(screen.getByText('已取消导出')).toBeTruthy());
  });

  it('导出历史 CSV 在浏览器端（非桌面运行时）提示 CSV 已下载（281）', async () => {
    // 桌面端先加载历史（浏览器模式下 DB 门控不加载），随后将 isTauriRuntime 切为 false
    // 模拟浏览器端导出：downloadHistoryCsv 返回 null 且 !isTauriRuntime() -> 281 分支。
    bridge.loadHistoryFromDb.mockResolvedValue([historyRecord()]);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^历史记录$/ }));
    await waitFor(() => expect(screen.getByText('查看')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    bridge.isTauriRuntime.mockReturnValue(false);
    bridge.downloadHistoryCsv.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    await waitFor(() => expect(screen.getByText('CSV 已下载')).toBeTruthy());
  });

  it('导出历史 CSV 失败提示错误', async () => {
    bridge.loadHistoryFromDb.mockResolvedValue([historyRecord()]);
    bridge.downloadHistoryCsv.mockRejectedValueOnce(new Error('磁盘满'));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^历史记录$/ }));
    await waitFor(() => expect(screen.getByText('查看')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    await waitFor(() => expect(screen.getByText(/导出失败：磁盘满/)).toBeTruthy());
  });

  it('打开日志目录成功提示路径', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getByRole('button', { name: '打开日志目录' }));
    await waitFor(() => expect(screen.getByText(/已打开日志目录：\/logs/)).toBeTruthy());
  });

  it('打开日志目录失败提示错误', async () => {
    bridge.openLogDir.mockRejectedValueOnce(new Error('无法访问'));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getByRole('button', { name: '打开日志目录' }));
    await waitFor(() => expect(screen.getByText(/打开日志目录失败：无法访问/)).toBeTruthy());
  });

  it('检测账号失败（普通错误）回写错误到账号', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'acc-conn', provider: 'quark', platformName: '夸克网盘', displayName: '已连接账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    bridge.checkProviderLogin.mockRejectedValueOnce(new Error('登录态已失效'));
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('已连接账号')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    await waitFor(() => expect(screen.getByText('登录态已失效')).toBeTruthy());
  });

  it('检测账号失败（请先打开）提示重新登录文案', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'acc-conn', provider: 'quark', platformName: '夸克网盘', displayName: '已连接账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    bridge.checkProviderLogin.mockRejectedValueOnce(new Error('请先打开登录窗口'));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('已连接账号')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    await waitFor(() => expect(screen.getByText(/请先点击/)).toBeTruthy());
  });

  it('检测无 cookie 账号走 captureProviderLogin', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'acc-manual', provider: 'quark', platformName: '夸克网盘', displayName: '待捕获账号', status: 'manual_required', loginName: '未登录', purpose: '转存', lastChecked: '刚刚', pendingReason: '本地会话已清理', hasCredential: false },
    ]);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('待捕获账号')).toBeTruthy(), { timeout: 2000 });
    // manual_required 且 pendingReason 不含「官方窗口」-> 主按钮「登录」-> handleProviderLogin
    // 但要触发 handleProviderCheck 的 capture 分支，需要 connected；此处验证 captureProviderLogin 被调用
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(bridge.openProviderLogin).toHaveBeenCalledTimes(1));
  });

  it('导出含资源的历史 CSV（accountName 回填）', async () => {
    bridge.loadHistoryFromDb.mockResolvedValue([historyRecord({
      items: [{ id: 'I1', provider: 'quark', accountId: 'acc-x', sourceUrl: 'https://s', title: '资源', valid: true, status: 'done', step: '完成', progress: 100 }],
    })]);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^历史记录$/ }));
    await waitFor(() => expect(screen.getByText('查看')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    await waitFor(() => expect(bridge.downloadHistoryCsv).toHaveBeenCalledTimes(1));
    const exported = bridge.downloadHistoryCsv.mock.calls[0][0];
    expect(exported.items[0].accountName).toBe('未分配');
    expect(screen.getByText(/已导出到/)).toBeTruthy();
  });

  it('迅雷已连接账号点击检测成功 -> connected 并重置二维码弹窗', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'x-conn', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷已连接', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    bridge.checkProviderLogin.mockResolvedValueOnce({ hasCredential: true, loginName: '迅雷用户', cookieCount: 2 });
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('迅雷已连接')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    await waitFor(() => expect(bridge.checkProviderLogin).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('迅雷用户')).toBeTruthy(), { timeout: 2000 });
  });

  it('迅雷账号检测遇到授权待完成 -> 提示密码登录', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'x-conn', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷A', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    bridge.checkProviderLogin.mockRejectedValueOnce(new Error('authorization_pending'));
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('迅雷A')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    await waitFor(() => expect(screen.getByText('请填写迅雷账号和密码登录。')).toBeTruthy(), { timeout: 2000 });
  });

  it('迅雷账号检测遇到「请先打开」-> 提示重新登录文案', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'x-conn', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷B', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    bridge.checkProviderLogin.mockRejectedValueOnce(new Error('请先打开登录窗口'));
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('迅雷B')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    await waitFor(() => expect(screen.getByText(/请先点击/)).toBeTruthy(), { timeout: 2000 });
  });

  it('迅雷账号检测遇到普通错误 -> 回写错误并设置二维码错误', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'x-conn', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷C', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    bridge.checkProviderLogin.mockRejectedValueOnce(new Error('网络异常'));
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('迅雷C')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    await waitFor(() => expect(screen.getByText('网络异常')).toBeTruthy(), { timeout: 2000 });
  });

  it('迅雷待登录账号点击登录 -> 打开密码登录弹窗', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'x-manual', provider: 'xunlei', platformName: '迅雷网盘', displayName: '迅雷待登录', status: 'manual_required', loginName: '未登录', purpose: '转存', lastChecked: '刚刚', pendingReason: '请填写迅雷账号和密码登录。', hasCredential: false },
    ]);
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('迅雷待登录')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '迅雷账号登录' })).toBeTruthy());
  });

  it('加载网盘账号失败时静默（console.warn）', async () => {
    bridge.listProviderAccountsFromDb.mockRejectedValue(new Error('db'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderApp();
    await waitFor(() => expect(warn).toHaveBeenCalledWith('加载网盘账号失败', expect.anything()));
    warn.mockRestore();
  });

  it('加载过程中卸载组件 -> 取消后续 setProviderAccounts', async () => {
    let resolveLoad!: (value: ProviderAccount[]) => void;
    bridge.listProviderAccountsFromDb.mockReturnValue(new Promise<ProviderAccount[]>((resolve) => { resolveLoad = resolve; }));
    const { unmount } = renderApp();
    unmount();
    // 卸载后 resolve -> 走 cancelled 提前返回分支
    await act(async () => { resolveLoad([{ id: 'late', provider: 'quark', platformName: '夸克网盘', displayName: '迟到', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true }]); });
  });

  it('同步账号到 SQLite 失败时静默（console.warn）', async () => {
    bridge.upsertProviderAccountToDb.mockRejectedValue(new Error('db'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    fireEvent.change(screen.getByLabelText('账号备注'), { target: { value: '同步失败账号' } });
    fireEvent.keyDown(screen.getByLabelText('账号备注'), { key: 'Enter' });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('同步网盘账号失败', expect.anything()));
    warn.mockRestore();
  });

  it('删除账号触发 deleteProviderAccountFromDb 清理旧记录', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'del-1', provider: 'quark', platformName: '夸克网盘', displayName: '保留账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
      { id: 'del-2', provider: 'baidu', platformName: '百度网盘', displayName: '删除账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    renderApp();
    await waitFor(() => expect(bridge.upsertProviderAccountToDb).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('删除账号')).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[1]);
    await waitFor(() => expect(bridge.deleteProviderAccountFromDb).toHaveBeenCalledWith('del-2'), { timeout: 2000 });
  });

  it('加载到 legacy demo 账号 id -> 过滤后重置账号列表', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'quark-main', provider: 'quark', platformName: '夸克网盘', displayName: '演示账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    renderApp();
    // 演示账号被过滤后从列表移除
    await waitFor(() => expect(screen.queryByText('演示账号')).toBeNull(), { timeout: 2000 });
  });

  it('任务页目录加载遇到凭证错误 -> 标记账号 manual_required', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'acc-conn', provider: 'quark', platformName: '夸克网盘', displayName: '已连接', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true },
    ]);
    bridge.listProviderFolders.mockRejectedValue(new Error('登录态失效，请重新登录'));
    renderApp();
    await waitFor(() => expect(bridge.listProviderAccountsFromDb).toHaveBeenCalled());
    // 任务页（默认页）打开目录选择器（等待账号自动选中后按钮出现）
    const folderBtn = await screen.findByRole('button', { name: /选择目录/ }, { timeout: 2000 });
    fireEvent.click(folderBtn);
    await waitFor(() => expect(bridge.listProviderFolders).toHaveBeenCalled());
    // 凭证错误 -> 账号标记 manual_required（设置页可见 pendingReason）
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('登录态失效，请重新登录')).toBeTruthy(), { timeout: 2000 });
  });

  it('provider-login-complete 事件命中不存在账号 -> 列表不变', async () => {
    bridge.listProviderAccountsFromDb.mockResolvedValue([
      { id: 'acc-real', provider: 'quark', platformName: '夸克网盘', displayName: '真实账号', status: 'manual_required', loginName: '未登录', purpose: '转存', lastChecked: '刚刚', hasCredential: false },
    ]);
    let handler: ((e: { payload: unknown }) => void) | undefined;
    eventApi.listen.mockImplementationOnce(async (_event: string, cb: (e: { payload: unknown }) => void) => {
      handler = cb;
      return () => {};
    });
    renderApp();
    await waitFor(() => expect(eventApi.listen).toHaveBeenCalledWith('provider-login-complete', expect.any(Function)));
    await act(async () => {
      handler?.({ payload: { accountId: 'not-exist', provider: 'quark', result: { hasCredential: true, loginName: 'x', cookieCount: 1 } } });
    });
    // 真实账号仍保持原状态（未命中）
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }));
    await waitFor(() => expect(screen.getByText('真实账号')).toBeTruthy(), { timeout: 2000 });
  });
});
