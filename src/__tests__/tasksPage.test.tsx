//! TasksPage 集成测试：覆盖三步向导的平台切换 / 账号筛选 / 资源导入（逐条/粘贴/CSV）/ 短链渠道 / 额度计算 / 提交。
//!
//! `parseImport` 与 `listProviderFolders` 来自 `../lib/bridge`，这里整体 mock，
//! 既避免触发 Tauri 运行时，也覆盖「解析失败回退本地解析」的兜底路径。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TasksPage } from '../pages/TasksPage';
import type { ProviderAccount, ShortLinkTarget } from '../types';
import type { DomainOption, QuotaState, YdisksAccountOption } from '../lib/types';

const bridge = vi.hoisted(() => ({
  parseImport: vi.fn(),
  listProviderFolders: vi.fn(),
}));
vi.mock('../lib/bridge', () => bridge);

const quarkAccount = (overrides: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'q1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '夸克账号1',
  status: 'connected',
  loginName: 'user1',
  purpose: '转存',
  lastChecked: '2024-01-01 00:00',
  cookie: 'ck',
  ...overrides,
});

const ydisksAccount = (overrides: Partial<YdisksAccountOption> = {}): YdisksAccountOption => ({
  id: 'y1',
  name: '推广账号1',
  accountTypeName: '夸克网盘',
  ...overrides,
});

const domain = (overrides: Partial<DomainOption> = {}): DomainOption => ({
  domainName: 'example.com',
  status: 'ACTIVE',
  ...overrides,
});

const target = (overrides: Partial<ShortLinkTarget> = {}): ShortLinkTarget => ({
  id: 't1',
  channelId: 'c1',
  channelName: '渠道A',
  domain: 'example.com',
  ydisksAccountId: 'y1',
  ydisksAccountName: '推广账号1',
  enabled: true,
  ...overrides,
});

const baseProps = (overrides: Record<string, unknown> = {}) => ({
  accounts: [quarkAccount()],
  dedupeEnabled: false,
  domainOptions: [domain()],
  quota: { maxLinks: 100, usedLinks: 0 } as QuotaState,
  shortLinkTargets: [target()],
  ydisksAccounts: [ydisksAccount()],
  onCreateBatch: vi.fn(),
  onProviderCredentialError: vi.fn(),
  onToggleDedupe: vi.fn(),
  ...overrides,
});

const QUARK_URL = 'https://pan.quark.cn/s/abc123';

describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.parseImport.mockResolvedValue({ accepted: [], filtered: 0 });
    bridge.listProviderFolders.mockResolvedValue([]);
  });

  it('渲染向导步骤与三段舞台、平台选择器', () => {
    render(<TasksPage {...baseProps()} />);
    expect(screen.getByText('新建批量任务')).toBeTruthy();
    // 向导步骤（与各舞台标题同名，故用 getAllByText 校验存在）
    expect(screen.getAllByText('账号').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('资源').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('执行').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('夸克网盘')).toBeTruthy();
    expect(screen.getByText('百度网盘')).toBeTruthy();
    expect(screen.getByText('迅雷网盘')).toBeTruthy();
    // 额度面板指标
    expect(screen.getByText('可执行资源')).toBeTruthy();
    expect(screen.getByText('短链渠道')).toBeTruthy();
  });

  it('无可用账号时下拉显示占位且提交禁用', () => {
    render(<TasksPage {...baseProps({ accounts: [quarkAccount({ status: 'expired', cookie: undefined })] })} />);
    expect(screen.getByText('无可用账号')).toBeTruthy();
    expect((screen.getByRole('button', { name: /创建任务并执行/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('未连接后台时进入仅转存模式：提示 + Ydisks 账号禁用 + 短链渠道禁用', () => {
    render(<TasksPage {...baseProps({ ydisksAccounts: [], shortLinkTargets: [target({ enabled: true })] })} />);
    expect(screen.getByText('仅转存模式')).toBeTruthy();
    // Ydisks 后台账号 select 禁用且显示未连接
    const ydisksSelect = screen.getByLabelText('Ydisks 后台账号') as HTMLSelectElement;
    expect(ydisksSelect.disabled).toBe(true);
    expect(ydisksSelect.value).toBe('');
    // 短链渠道区域展示禁用提示而非渠道开关
    expect(screen.getByText('未连接 Ydisks 后台，本次仅转存。连接 API Key 后可在此一键创建多渠道短链。')).toBeTruthy();
  });

  it('逐条添加：parseImport 成功后资源进入清单', async () => {
    bridge.parseImport.mockResolvedValue({
      accepted: [{ title: '资源1', sourceUrl: QUARK_URL, provider: 'quark' as const }],
      filtered: 0,
    });
    render(<TasksPage {...baseProps()} />);
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: QUARK_URL } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '资源1' } });
    fireEvent.click(screen.getByRole('button', { name: /添加到清单/ }));
    await waitFor(() => expect(screen.getByText('已添加 1')).toBeTruthy());
    expect(screen.getByText('已过滤 0')).toBeTruthy();
    expect(bridge.parseImport).toHaveBeenCalledWith(expect.objectContaining({ mode: 'text', provider: 'quark', text: '资源1,https://pan.quark.cn/s/abc123' }));
  });

  it('parseImport 失败时回退本地解析（catch 分支）', async () => {
    bridge.parseImport.mockRejectedValue(new Error('backend down'));
    render(<TasksPage {...baseProps()} />);
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: QUARK_URL } });
    fireEvent.click(screen.getByRole('button', { name: /添加到清单/ }));
    await waitFor(() => expect(screen.getByText('已添加 1')).toBeTruthy());
    expect(bridge.parseImport).toHaveBeenCalled();
  });

  it('parseImport 成功但返回过滤项时累加 filterCount', async () => {
    bridge.parseImport.mockResolvedValue({
      accepted: [{ title: 'ok', sourceUrl: QUARK_URL, provider: 'quark' as const }],
      filtered: 2,
    });
    render(<TasksPage {...baseProps()} />);
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: QUARK_URL } });
    fireEvent.click(screen.getByRole('button', { name: /添加到清单/ }));
    await waitFor(() => expect(screen.getByText('已过滤 2')).toBeTruthy());
  });

  it('本地回退解析时过滤非本平台资源（addResources 过滤分支）', async () => {
    bridge.parseImport.mockRejectedValue(new Error('down'));
    render(<TasksPage {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '粘贴解析' }));
    const textarea = screen.getByLabelText('粘贴批量链接');
    fireEvent.change(textarea, { target: { value: `${QUARK_URL}\nhttps://pan.baidu.com/s/xxx` } });
    fireEvent.click(screen.getByRole('button', { name: /解析并加入清单/ }));
    // 百度链接与本平台（夸克）不符 -> 本地过滤丢弃
    await waitFor(() => expect(screen.getByText('已过滤 1')).toBeTruthy());
  });

  it('粘贴解析模式：切换标签并解析多行', async () => {
    bridge.parseImport.mockResolvedValue({
      accepted: [
        { title: 'a', sourceUrl: QUARK_URL, provider: 'quark' as const },
        { title: 'b', sourceUrl: 'https://pan.quark.cn/s/def', provider: 'quark' as const },
      ],
      filtered: 0,
    });
    render(<TasksPage {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '粘贴解析' }));
    const textarea = screen.getByLabelText('粘贴批量链接');
    fireEvent.change(textarea, { target: { value: `${QUARK_URL}\nhttps://pan.quark.cn/s/def` } });
    fireEvent.click(screen.getByRole('button', { name: /解析并加入清单/ }));
    await waitFor(() => expect(screen.getByText('已添加 2')).toBeTruthy());
  });

  it('CSV 导入：读取文件并解析', async () => {
    bridge.parseImport.mockResolvedValue({
      accepted: [{ title: 'csv资源', sourceUrl: QUARK_URL, provider: 'quark' as const }],
      filtered: 0,
    });
    render(<TasksPage {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'CSV 导入' }));
    const input = screen.getByLabelText('导入 CSV') as HTMLInputElement;
    const csvContent = '标题,网盘链接\ncsv资源,https://pan.quark.cn/s/abc123';
    const file = new File([csvContent], 't.csv', { type: 'text/csv' });
    // jsdom 的 File 没有 .text()，这里补上
    Object.defineProperty(file, 'text', { value: async () => csvContent, configurable: true });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('已添加 1')).toBeTruthy());
    expect(bridge.parseImport).toHaveBeenCalledWith(expect.objectContaining({ mode: 'csv' }));
  });

  it('CSV 选择但无文件时直接返回', async () => {
    render(<TasksPage {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'CSV 导入' }));
    const input = screen.getByLabelText('导入 CSV') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    // 没有 parseImport 调用
    expect(bridge.parseImport).not.toHaveBeenCalled();
  });

  it('开启去重开关触发 onToggleDedupe', () => {
    const onToggleDedupe = vi.fn();
    render(<TasksPage {...baseProps({ onToggleDedupe })} />);
    const toggle = screen.getAllByLabelText('开启去重')[0];
    fireEvent.click(toggle);
    expect(onToggleDedupe).toHaveBeenCalledTimes(1);
  });

  it('切换网盘平台会清空资源并切换默认目录', async () => {
    bridge.parseImport.mockResolvedValue({
      accepted: [{ title: 'r', sourceUrl: QUARK_URL, provider: 'quark' as const }],
      filtered: 0,
    });
    render(<TasksPage {...baseProps()} />);
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: QUARK_URL } });
    fireEvent.click(screen.getByRole('button', { name: /添加到清单/ }));
    await waitFor(() => expect(screen.getByText('已添加 1')).toBeTruthy());
    // 切到百度
    fireEvent.click(screen.getByRole('button', { name: /百度网盘/ }));
    await waitFor(() => expect(screen.getByText('已添加 0')).toBeTruthy());
    expect(screen.getByText('暂无资源')).toBeTruthy();
  });

  it('从清单删除资源', async () => {
    bridge.parseImport.mockResolvedValue({
      accepted: [{ title: '要删的', sourceUrl: QUARK_URL, provider: 'quark' as const }],
      filtered: 0,
    });
    render(<TasksPage {...baseProps()} />);
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: QUARK_URL } });
    fireEvent.click(screen.getByRole('button', { name: /添加到清单/ }));
    await waitFor(() => expect(screen.getByText('已添加 1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.getByText('暂无资源')).toBeTruthy());
  });

  it('提交批次：调用 onCreateBatch 并清空清单', async () => {
    bridge.parseImport.mockResolvedValue({
      accepted: [{ title: '资源1', sourceUrl: QUARK_URL, provider: 'quark' as const }],
      filtered: 0,
    });
    const onCreateBatch = vi.fn();
    render(<TasksPage {...baseProps({ onCreateBatch })} />);
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: QUARK_URL } });
    fireEvent.click(screen.getByRole('button', { name: /添加到清单/ }));
    await waitFor(() => expect((screen.getByRole('button', { name: /创建任务并执行/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /创建任务并执行/ }));
    await waitFor(() => expect(onCreateBatch).toHaveBeenCalledTimes(1));
    const draft = onCreateBatch.mock.calls[0][0];
    expect(draft.provider).toBe('quark');
    expect(draft.providerAccountId).toBe('q1');
    expect(draft.resources).toHaveLength(1);
    expect(draft.executable).toBe(1);
    expect(draft.waitingQuota).toBe(0);
    // 提交后清单清空
    await waitFor(() => expect(screen.getByText('暂无资源')).toBeTruthy());
  });

  it('额度不足时显示警告并计算等待资源', async () => {
    // 2 条资源，1 个渠道，余量 1 -> 可执行 1，等待 1
    bridge.parseImport.mockResolvedValue({
      accepted: [
        { title: 'a', sourceUrl: QUARK_URL, provider: 'quark' as const },
        { title: 'b', sourceUrl: 'https://pan.quark.cn/s/zzz', provider: 'quark' as const },
      ],
      filtered: 0,
    });
    render(<TasksPage {...baseProps({ quota: { maxLinks: 1, usedLinks: 0 } })} />);
    fireEvent.change(screen.getByLabelText('网盘链接'), { target: { value: QUARK_URL } });
    fireEvent.click(screen.getByRole('button', { name: /添加到清单/ }));
    await waitFor(() => expect(screen.getByText('已添加 2')).toBeTruthy());
    expect(screen.getByText('额度不足')).toBeTruthy();
    expect(screen.getByText('等待资源')).toBeTruthy();
  });

  it('打开目录选择器并选择文件夹更新目标目录', async () => {
    bridge.listProviderFolders.mockResolvedValue([
      { name: '子目录', folderRef: 'fid:sub', parentRef: 'fid:0', isDir: true },
    ]);
    render(<TasksPage {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    expect(screen.getByRole('dialog', { name: '选择目标文件夹' })).toBeTruthy();
    await waitFor(() => expect(bridge.listProviderFolders).toHaveBeenCalled());
    const folderBtn = await screen.findByRole('button', { name: /子目录/ });
    fireEvent.click(folderBtn);
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    // 关闭后目录名更新为子目录
    expect(screen.getByText('子目录')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('目录加载遇到凭证错误回调 onProviderCredentialError', async () => {
    bridge.listProviderFolders.mockRejectedValue(new Error('登录态失效，请重新登录'));
    const onProviderCredentialError = vi.fn();
    render(<TasksPage {...baseProps({ onProviderCredentialError })} />);
    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await waitFor(() => expect(onProviderCredentialError).toHaveBeenCalledWith('q1', expect.stringContaining('登录')));
  });

  it('目录加载遇到非凭证错误时显示错误但不回调', async () => {
    bridge.listProviderFolders.mockRejectedValue(new Error('网络错误'));
    const onProviderCredentialError = vi.fn();
    render(<TasksPage {...baseProps({ onProviderCredentialError })} />);
    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await waitFor(() => expect(screen.getByText('读取失败')).toBeTruthy());
    expect(onProviderCredentialError).not.toHaveBeenCalled();
  });

  it('关闭目录选择器不选择目录', async () => {
    bridge.listProviderFolders.mockResolvedValue([]);
    render(<TasksPage {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('后台账号按平台筛选：夸克平台只显示夸克后台账号', () => {
    render(<TasksPage {...baseProps({
      ydisksAccounts: [
        ydisksAccount({ id: 'yq', name: '夸克推广', accountTypeName: '夸克网盘' }),
        ydisksAccount({ id: 'yb', name: '百度推广', accountTypeName: '百度网盘' }),
      ],
    })} />);
    const ydisksSelect = screen.getByLabelText('Ydisks 后台账号') as HTMLSelectElement;
    const options = Array.from(ydisksSelect.options).map((o) => o.textContent);
    expect(options).toContain('夸克推广');
    expect(options).not.toContain('百度推广');
  });

  it('切换到百度后，后台账号自动切到百度推广账号', () => {
    render(<TasksPage {...baseProps({
      accounts: [quarkAccount(), quarkAccount({ id: 'b1', provider: 'baidu', platformName: '百度网盘', displayName: '百度账号1', cookie: 'bk' })],
      ydisksAccounts: [
        ydisksAccount({ id: 'yq', name: '夸克推广', accountTypeName: '夸克网盘' }),
        ydisksAccount({ id: 'yb', name: '百度推广', accountTypeName: '百度网盘' }),
      ],
    })} />);
    fireEvent.click(screen.getByRole('button', { name: /百度网盘/ }));
    const ydisksSelect = screen.getByLabelText('Ydisks 后台账号') as HTMLSelectElement;
    expect(ydisksSelect.value).toBe('yb');
  });

  it('域名下拉过滤掉非 ACTIVE 域名', () => {
    render(<TasksPage {...baseProps({
      domainOptions: [
        domain({ domainName: 'active.com', status: 'ACTIVE' }),
        domain({ domainName: 'inactive.com', status: 'INACTIVE' }),
      ],
      shortLinkTargets: [target({ domain: 'active.com' })],
    })} />);
    const domainSelect = screen.getByLabelText('渠道A短链域名') as HTMLSelectElement;
    const opts = Array.from(domainSelect.options).map((o) => o.textContent);
    expect(opts).toContain('active.com');
    expect(opts).not.toContain('inactive.com');
  });

  it('切换短链渠道开关更新渠道数', () => {
    const metricValue = (label: string) => screen.getByText(label).parentElement?.querySelector('strong')?.textContent;
    render(<TasksPage {...baseProps({ shortLinkTargets: [target({ enabled: true, channelName: '渠道A' })] })} />);
    expect(metricValue('短链渠道')).toBe('1');
    fireEvent.click(screen.getByLabelText('渠道A'));
    expect(metricValue('短链渠道')).toBe('0');
  });

  it('切换渠道域名更新 targets', () => {
    render(<TasksPage {...baseProps({
      domainOptions: [domain({ domainName: 'a.com' }), domain({ domainName: 'b.com' })],
      shortLinkTargets: [target({ domain: 'a.com', channelName: '渠道A' })],
    })} />);
    const domainSelect = screen.getByLabelText('渠道A短链域名') as HTMLSelectElement;
    fireEvent.change(domainSelect, { target: { value: 'b.com' } });
    expect(domainSelect.value).toBe('b.com');
  });

  it('全部域名非 ACTIVE 时回退使用全部域名', () => {
    render(<TasksPage {...baseProps({
      domainOptions: [domain({ domainName: 'only.com', status: 'INACTIVE' })],
      shortLinkTargets: [target({ domain: 'only.com' })],
    })} />);
    const domainSelect = screen.getByLabelText('渠道A短链域名') as HTMLSelectElement;
    expect(Array.from(domainSelect.options).map((o) => o.textContent)).toContain('only.com');
  });

  it('短链目标域名不在可用列表 -> 重置为默认域名', () => {
    render(<TasksPage {...baseProps({
      domainOptions: [domain({ domainName: 'example.com' })],
      shortLinkTargets: [target({ domain: 'stale.com', channelName: '渠道A', enabled: true })],
    })} />);
    const domainSelect = screen.getByLabelText('渠道A短链域名') as HTMLSelectElement;
    expect(domainSelect.value).toBe('example.com');
  });
});
