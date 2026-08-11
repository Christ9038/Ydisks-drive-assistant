import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../lib/bridge', () => ({
  listProviderFolders: vi.fn(),
}));

import { listProviderFolders } from '../lib/bridge';
import {
  ConfirmDialog,
  CookiePasteModal,
  XunleiQrModal,
  XunleiPasswordModal,
  FolderPickerModal,
  DirectorySelectField,
} from '../components/modals';
import { defaultFolderRefs } from '../lib/constants';
import type { ProviderAccount } from '../types';
import type { RustProviderFolderItem, RustXunleiLoginQrResult } from '../lib/types';

const account = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'a1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主账号',
  status: 'connected',
  loginName: 'u',
  purpose: '转存',
  lastChecked: '',
  hasCredential: true,
  ...over,
});

const folder = (over: Partial<RustProviderFolderItem> = {}): RustProviderFolderItem => ({
  name: '子目录',
  folderRef: 'ref-child',
  parentRef: 'ref-root',
  isDir: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConfirmDialog', () => {
  it('点击内部窗口不触发 onClose（阻止冒泡）', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog title="t" message="m" confirmLabel="确定" onConfirm={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByText('m'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CookiePasteModal', () => {
  it('展示错误并响应粘贴与提交', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<CookiePasteModal account={account()} error="校验失败" saving={false} value="" onChange={onChange} onClose={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText('校验失败')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('粘贴完整 Cookie'), { target: { value: 'k=v' } });
    expect(onChange).toHaveBeenCalledWith('k=v');
    // 空值时提交按钮禁用
    expect((screen.getByRole('button', { name: /保存 Cookie/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('有值时提交触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(<CookiePasteModal account={account()} error="" saving={false} value="k=v" onChange={() => {}} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /保存 Cookie/ }));
    expect(onSubmit).toHaveBeenCalled();
  });
  it('saving 时禁用并显示保存中', () => {
    render(<CookiePasteModal account={account()} error="" saving={true} value="k=v" onChange={() => {}} onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText('保存中')).toBeTruthy();
    expect((screen.getByRole('button', { name: /保存中/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<CookiePasteModal account={account()} error="" saving={false} value="" onChange={() => {}} onClose={onClose} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('XunleiQrModal', () => {
  const qr: RustXunleiLoginQrResult = { userCode: 'ABC123', qrcodeSvg: '<svg></svg>', qrcodeUrl: 'u', expiresIn: 60 };
  it('loading 时显示占位且按钮禁用', () => {
    render(<XunleiQrModal account={account()} error="" loading={true} qr={null} onClose={() => {}} onRefresh={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText('正在生成授权二维码')).toBeTruthy();
    expect((screen.getByRole('button', { name: '立即检查' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('有二维码时渲染授权码与有效期', () => {
    render(<XunleiQrModal account={account()} error="" loading={false} qr={qr} onClose={() => {}} onRefresh={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText(/60 秒内有效/)).toBeTruthy();
  });
  it('userCode 为空时显示占位', () => {
    render(<XunleiQrModal account={account()} error="" loading={false} qr={{ ...qr, userCode: '' }} onClose={() => {}} onRefresh={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText('-')).toBeTruthy();
  });
  it('错误展示 + 刷新 / 检查回调', () => {
    const onRefresh = vi.fn();
    const onSubmit = vi.fn();
    render(<XunleiQrModal account={account()} error="超时" loading={false} qr={qr} onClose={() => {}} onRefresh={onRefresh} onSubmit={onSubmit} />);
    expect(screen.getByText('超时')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '立即检查' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }));
    expect(onSubmit).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });
});

describe('XunleiPasswordModal', () => {
  const base = {
    account: account(),
    creditKey: '',
    error: '',
    password: '',
    rawReviewUrl: '',
    reviewUrl: '',
    saving: false,
    username: '',
    onChangeCreditKey: () => {},
    onChangePassword: () => {},
    onChangeUsername: () => {},
    onClose: () => {},
    onOpenReviewUrl: () => {},
    onSubmit: () => {},
  };

  it('无账号密码时登录按钮禁用', () => {
    render(<XunleiPasswordModal {...base} />);
    expect((screen.getByRole('button', { name: '登录' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('输入账号密码并回车提交，字段变更上抛', () => {
    const onChangeUsername = vi.fn();
    const onChangePassword = vi.fn();
    const onChangeCreditKey = vi.fn();
    const onSubmit = vi.fn();
    const { container } = render(<XunleiPasswordModal {...base} username="u" password="p" reviewUrl="https://x" creditKey="" onChangeUsername={onChangeUsername} onChangePassword={onChangePassword} onChangeCreditKey={onChangeCreditKey} onSubmit={onSubmit} />);
    const passwordInput = container.querySelector('input[type="password"]')!;
    fireEvent.keyDown(passwordInput, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalled();
    const usernameInput = container.querySelector('input:not([type="password"])')!;
    fireEvent.change(usernameInput, { target: { value: 'u2' } });
    expect(onChangeUsername).toHaveBeenCalledWith('u2');
    fireEvent.change(passwordInput, { target: { value: 'p2' } });
    expect(onChangePassword).toHaveBeenCalledWith('p2');
    const creditLabel = Array.from(container.querySelectorAll('label.field')).find((l) => l.querySelector('span')?.textContent === 'CreditKey')!;
    const creditInput = creditLabel.querySelector('input') as HTMLInputElement;
    fireEvent.change(creditInput, { target: { value: 'ck' } });
    expect(onChangeCreditKey).toHaveBeenCalledWith('ck');
  });
  it('reviewUrl 含 deviceid 时显示含 deviceid 提示', () => {
    render(<XunleiPasswordModal {...base} reviewUrl="https://x?deviceid=abc" />);
    expect(screen.getByText('验证链接（含 deviceid）')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开验证页' })).toBeTruthy();
  });
  it('reviewUrl 不含 deviceid 时显示缺少提示', () => {
    render(<XunleiPasswordModal {...base} reviewUrl="https://x" />);
    expect(screen.getByText('验证链接缺少 deviceid')).toBeTruthy();
  });
  it('rawReviewUrl 与 reviewUrl 不同时展示原始地址', () => {
    render(<XunleiPasswordModal {...base} reviewUrl="https://x?deviceid=1" rawReviewUrl="https://raw" />);
    expect(screen.getByText('接口原始地址')).toBeTruthy();
    // 两个只读输入框聚焦时全选文本（onFocus）
    const reviewInput = screen.getByDisplayValue('https://x?deviceid=1') as HTMLInputElement;
    const rawInput = screen.getByDisplayValue('https://raw') as HTMLInputElement;
    reviewInput.focus();
    expect(document.activeElement).toBe(reviewInput);
    rawInput.focus();
    expect(document.activeElement).toBe(rawInput);
  });
  it('有 reviewUrl 且 error 时使用 warning 色调与二次验证标题', () => {
    render(<XunleiPasswordModal {...base} reviewUrl="https://x" error="需验证" />);
    expect(document.querySelector('.callout.warning')).toBeTruthy();
    expect(screen.getByText('需要二次验证')).toBeTruthy();
  });
  it('无 reviewUrl 且 error 时使用 danger 色调与登录失败标题', () => {
    render(<XunleiPasswordModal {...base} error="失败" />);
    expect(document.querySelector('.callout.danger')).toBeTruthy();
    expect(screen.getByText('登录失败')).toBeTruthy();
  });
  it('saving 时显示登录中并禁用', () => {
    render(<XunleiPasswordModal {...base} username="u" password="p" saving={true} />);
    expect(screen.getByText('登录中')).toBeTruthy();
  });
  it('有 reviewUrl 时主按钮文案为验证后继续登录', () => {
    render(<XunleiPasswordModal {...base} username="u" password="p" reviewUrl="https://x" />);
    expect(screen.getByRole('button', { name: '验证后继续登录' })).toBeTruthy();
  });
  it('打开验证页与关闭回调', () => {
    const onOpenReviewUrl = vi.fn();
    const onClose = vi.fn();
    render(<XunleiPasswordModal {...base} reviewUrl="https://x" onOpenReviewUrl={onOpenReviewUrl} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '打开验证页' }));
    expect(onOpenReviewUrl).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('FolderPickerModal', () => {
  const rootRef = defaultFolderRefs.quark;

  it('initialFolderRef 为根目录时面包屑仅显示根目录', async () => {
    vi.mocked(listProviderFolders).mockResolvedValueOnce([]);
    render(<FolderPickerModal account={account()} initialFolderName="" initialFolderRef={rootRef} provider="quark" onClose={() => {}} onCredentialError={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('没有子文件夹')).toBeTruthy());
    const crumbs = screen.getAllByRole('button').filter((b) => b.textContent === '根目录');
    expect(crumbs).toHaveLength(1);
  });

  it('initialFolderRef 非根目录时面包屑含已选目录', async () => {
    vi.mocked(listProviderFolders).mockResolvedValueOnce([]);
    render(<FolderPickerModal account={account()} initialFolderName="我的目录" initialFolderRef="ref-other" provider="quark" onClose={() => {}} onCredentialError={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getAllByText('我的目录').length).toBeGreaterThanOrEqual(1));
  });

  it('渲染子文件夹并点击进入触发再次加载', async () => {
    vi.mocked(listProviderFolders)
      .mockResolvedValueOnce([folder({ name: 'A', folderRef: 'ref-a' })])
      .mockResolvedValueOnce([]);
    render(<FolderPickerModal account={account()} initialFolderName="" initialFolderRef={rootRef} provider="quark" onClose={() => {}} onCredentialError={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy());
    fireEvent.click(screen.getByText('A'));
    await waitFor(() => expect(listProviderFolders).toHaveBeenCalledTimes(2));
  });

  it('凭证错误时回传 onCredentialError', async () => {
    const onCredentialError = vi.fn();
    vi.mocked(listProviderFolders).mockRejectedValueOnce({ message: '账号缺少登录态' });
    render(<FolderPickerModal account={account()} initialFolderName="" initialFolderRef={rootRef} provider="quark" onClose={() => {}} onCredentialError={onCredentialError} onSelect={() => {}} />);
    await waitFor(() => expect(onCredentialError).toHaveBeenCalledWith('账号缺少登录态'));
  });

  it('非凭证错误时展示读取失败且不回传', async () => {
    const onCredentialError = vi.fn();
    vi.mocked(listProviderFolders).mockRejectedValueOnce({ message: '网络错误' });
    render(<FolderPickerModal account={account()} initialFolderName="" initialFolderRef={rootRef} provider="quark" onClose={() => {}} onCredentialError={onCredentialError} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('网络错误')).toBeTruthy());
    expect(onCredentialError).not.toHaveBeenCalled();
  });

  it('面包屑跳转触发重新加载', async () => {
    vi.mocked(listProviderFolders)
      .mockResolvedValueOnce([folder({ name: 'A', folderRef: 'ref-a' })])
      .mockResolvedValueOnce([]);
    render(<FolderPickerModal account={account()} initialFolderName="已选" initialFolderRef="ref-other" provider="quark" onClose={() => {}} onCredentialError={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy());
    fireEvent.click(screen.getByText('根目录'));
    await waitFor(() => expect(listProviderFolders).toHaveBeenCalledTimes(2));
  });

  it('确认选择触发 onSelect', async () => {
    vi.mocked(listProviderFolders).mockResolvedValueOnce([]);
    const onSelect = vi.fn();
    render(<FolderPickerModal account={account()} initialFolderName="" initialFolderRef={rootRef} provider="quark" onClose={() => {}} onCredentialError={() => {}} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('没有子文件夹')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
    expect(onSelect).toHaveBeenCalledWith({ name: '根目录', folderRef: rootRef });
  });

  it('取消按钮触发 onClose', async () => {
    vi.mocked(listProviderFolders).mockResolvedValueOnce([]);
    const onClose = vi.fn();
    render(<FolderPickerModal account={account()} initialFolderName="" initialFolderRef={rootRef} provider="quark" onClose={onClose} onCredentialError={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('没有子文件夹')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DirectorySelectField', () => {
  it('无账号时禁用并提示暂无可用账号', () => {
    render(<DirectorySelectField account={undefined} folderName="" provider="quark" onOpen={() => {}} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText('暂无可用夸克账号')).toBeTruthy();
  });
  it('账号不可用（无 cookie）时禁用', () => {
    render(<DirectorySelectField account={account({ hasCredential: false, status: 'expired' })} folderName="目录" provider="quark" onOpen={() => {}} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('账号可用时启用并点击触发 onOpen，空目录名显示根目录', () => {
    const onOpen = vi.fn();
    render(<DirectorySelectField account={account()} folderName="" provider="quark" onOpen={onOpen} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByText('根目录')).toBeTruthy();
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalled();
  });
  it('wide 属性附加样式', () => {
    render(<DirectorySelectField account={account()} folderName="d" provider="quark" wide onOpen={() => {}} />);
    expect(document.querySelector('.directory-field.wide-field')).toBeTruthy();
  });
});
