import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPage } from '../pages/SettingsPage';
import type { ProviderAccount } from '../types';

const account = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'a1', provider: 'quark', platformName: '夸克网盘', displayName: '主账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true, ...over,
});

const baseProps = (over: Record<string, unknown> = {}) => ({
  apiError: '',
  apiStatusLabel: '未连接',
  apiStatusTitle: undefined,
  apiStatusTone: 'danger' as const,
  connectedAccountCount: 0,
  providers: [] as ProviderAccount[],
  quota: { maxLinks: 100, usedLinks: 0 },
  themeMode: 'system' as const,
  transferIntervals: { quark: 4, baidu: 4, xunlei: 4 },
  onClearApiKey: vi.fn(),
  onDetectApiKey: vi.fn(),
  onProviderAdd: vi.fn(),
  onProviderCheck: vi.fn(),
  onProviderClear: vi.fn(),
  onProviderDelete: vi.fn(),
  onProviderCookiePaste: vi.fn(),
  onProviderLogin: vi.fn(),
  onThemeModeChange: vi.fn(),
  onTransferIntervalChange: vi.fn(),
  onOpenLogDir: vi.fn(),
  ...over,
});

describe('SettingsPage - 后台连接', () => {
  it('展示额度指标与检测 / 清除按钮', () => {
    const props = baseProps({ quota: { maxLinks: 100, usedLinks: 5 }, apiStatusTone: 'success', apiStatusLabel: '已连接' });
    render(<SettingsPage {...props} />);
    expect(screen.getByText('已用短链').parentElement!.querySelector('strong')!.textContent).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: /检测连接/ }));
    fireEvent.click(screen.getByRole('button', { name: /清除密钥/ }));
    expect(props.onDetectApiKey).toHaveBeenCalled();
    expect(props.onClearApiKey).toHaveBeenCalled();
  });

  it('有 apiError 时展示连接失败', () => {
    render(<SettingsPage {...baseProps({ apiError: 'Key 无效' })} />);
    expect(screen.getByText('Key 无效')).toBeTruthy();
  });

  it('主题切换与打开日志目录', () => {
    const props = baseProps();
    render(<SettingsPage {...props} />);
    fireEvent.click(screen.getByText('日间'));
    expect(props.onThemeModeChange).toHaveBeenCalledWith('light');
    fireEvent.click(screen.getByRole('button', { name: /打开日志目录/ }));
    expect(props.onOpenLogDir).toHaveBeenCalled();
  });

  it('展示三平台转存间隔并提交修改', () => {
    const props = baseProps();
    render(<SettingsPage {...props} />);
    expect((screen.getByLabelText('夸克转存间隔') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('百度转存间隔') as HTMLInputElement).min).toBe('3');
    fireEvent.change(screen.getByLabelText('迅雷转存间隔'), { target: { value: '8' } });
    expect(props.onTransferIntervalChange).toHaveBeenCalledWith('xunlei', 8);
  });
});

describe('SettingsPage - 账号管理', () => {
  it('无账号时显示暂无账号', () => {
    render(<SettingsPage {...baseProps({ providers: [] })} />);
    expect(screen.getAllByText('暂无账号').length).toBeGreaterThan(0);
  });

  it('添加账号表单：Enter 提交、Escape 取消、空名禁用', () => {
    const onProviderAdd = vi.fn();
    render(<SettingsPage {...baseProps({ onProviderAdd })} />);
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    const input = screen.getByLabelText('账号备注') as HTMLInputElement;
    expect(input.value).toBeTruthy();
    // 空名时保存禁用
    fireEvent.change(input, { target: { value: '' } });
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    // 重新输入并回车提交
    fireEvent.change(input, { target: { value: '我的账号' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onProviderAdd).toHaveBeenCalledWith('quark', '我的账号');
  });

  it('Escape 关闭添加表单', () => {
    render(<SettingsPage {...baseProps()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '添加账号' })[0]);
    const input = screen.getByLabelText('账号备注');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('账号备注')).toBeNull();
  });

  it('已连接账号卡片：检测 / 更新 Cookie / 清理 / 删除', () => {
    const onProviderCheck = vi.fn();
    const onProviderClear = vi.fn();
    const onProviderDelete = vi.fn();
    const onProviderCookiePaste = vi.fn();
    render(<SettingsPage {...baseProps({ providers: [account({ status: 'connected', hasCredential: true })], onProviderCheck, onProviderClear, onProviderDelete, onProviderCookiePaste })} />);
    fireEvent.click(screen.getByRole('button', { name: '检测' }));
    expect(onProviderCheck).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: '更新 Cookie' }));
    expect(onProviderCookiePaste).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: '清理会话' }));
    expect(onProviderClear).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onProviderDelete).toHaveBeenCalledWith('a1');
  });

  it('登录过期账号卡片：登录 / 粘贴 Cookie', () => {
    const onProviderLogin = vi.fn();
    render(<SettingsPage {...baseProps({ providers: [account({ status: 'expired', hasCredential: false })], onProviderLogin })} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(onProviderLogin).toHaveBeenCalledWith('a1');
    expect(screen.getByRole('button', { name: '粘贴 Cookie' })).toBeTruthy();
  });

  it('manual_required 账号卡片显示需要处理', () => {
    render(<SettingsPage {...baseProps({ providers: [account({ status: 'manual_required', hasCredential: true, pendingReason: '需重新登录' })] })} />);
    expect(screen.getByText('需要处理')).toBeTruthy();
    expect(screen.getByText('需重新登录')).toBeTruthy();
  });

  it('迅雷账号无粘贴 Cookie，显示登录', () => {
    render(<SettingsPage {...baseProps({ providers: [account({ id: 'x1', provider: 'xunlei', platformName: '迅雷网盘', status: 'expired', hasCredential: false })] })} />);
    expect(screen.queryByRole('button', { name: /粘贴 Cookie/ })).toBeNull();
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
  });
});
