import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const bridge = vi.hoisted(() => ({
  checkXunleiLogin: vi.fn(),
  closeXunleiReviewWindow: vi.fn(),
  loginXunleiPassword: vi.fn(),
  openXunleiReviewWindow: vi.fn(),
  startXunleiLogin: vi.fn(),
  isTauriRuntime: vi.fn(() => false),
}));
vi.mock('../lib/bridge', () => bridge);

const eventApi = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => eventApi);

import { useXunleiLogin } from '../hooks/useXunleiLogin';
import type { ProviderAccount } from '../types';
import type { ToastState } from '../hooks/useToast';
import type { RustXunleiLoginQrResult } from '../lib/types';

const xunleiAccount = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'x1',
  provider: 'xunlei',
  platformName: '迅雷网盘',
  displayName: '迅雷主号',
  status: 'expired',
  loginName: '',
  purpose: '转存',
  lastChecked: '',
  hasCredential: false,
  ...over,
});

const qr: RustXunleiLoginQrResult = { userCode: 'UC1', qrcodeSvg: '<svg/>', qrcodeUrl: 'u', expiresIn: 60 };

const renderLogin = (accounts: ProviderAccount[], update = vi.fn(), setToast = (_: ToastState | null) => {}) =>
  renderHook(({ accs, upd, toast }) => useXunleiLogin(accs, upd, toast), {
    initialProps: { accs: accounts, upd: update, toast: setToast },
  });

beforeEach(() => {
  vi.clearAllMocks();
  bridge.isTauriRuntime.mockReturnValue(false);
  bridge.startXunleiLogin.mockResolvedValue(qr);
  bridge.checkXunleiLogin.mockResolvedValue({ status: 'pending' });
  bridge.loginXunleiPassword.mockResolvedValue({ hasCredential: true, loginName: '雷用户', cookieCount: 3 });
  bridge.openXunleiReviewWindow.mockResolvedValue(undefined);
  bridge.closeXunleiReviewWindow.mockResolvedValue(undefined);
  eventApi.listen.mockResolvedValue(vi.fn());
});

describe('useXunleiLogin - 扫码授权', () => {
  it('openXunleiAuthorization 成功设置二维码', async () => {
    const { result } = renderLogin([xunleiAccount()]);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    expect(result.current.xunleiQr).toEqual(qr);
    expect(result.current.xunleiQrLoading).toBe(false);
    expect(result.current.xunleiQrAccount?.id).toBe('x1');
  });

  it('openXunleiAuthorization 失败设置错误并标记账号', async () => {
    bridge.startXunleiLogin.mockRejectedValue({ message: '生成二维码失败' });
    const update = vi.fn();
    const { result } = renderLogin([xunleiAccount()], update);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    expect(result.current.xunleiQrError).toBe('生成二维码失败');
    expect(result.current.xunleiQrLoading).toBe(false);
    expect(update).toHaveBeenCalledWith('x1', expect.any(Function));
    const updater = update.mock.calls[0][1];
    const updated = updater(xunleiAccount());
    expect(updated.status).toBe('manual_required');
    expect(updated.pendingReason).toBe('生成二维码失败');
  });

  it('resetXunleiQrModal / setXunleiQrError 清理扫码弹窗', async () => {
    const { result } = renderLogin([xunleiAccount()]);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    act(() => result.current.setXunleiQrError('手动错误'));
    expect(result.current.xunleiQrError).toBe('手动错误');
    act(() => result.current.resetXunleiQrModal());
    expect(result.current.xunleiQrAccountId).toBeNull();
    expect(result.current.xunleiQr).toBeNull();
    expect(result.current.xunleiQrError).toBe('');
  });
});

describe('useXunleiLogin - 账号密码登录', () => {
  it('openXunleiPasswordLogin 打开并清空字段', () => {
    const { result } = renderLogin([xunleiAccount()]);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    expect(result.current.xunleiLoginAccountId).toBe('x1');
    expect(result.current.xunleiUsername).toBe('');
    expect(result.current.xunleiLoginAccount?.id).toBe('x1');
  });

  it('submitXunleiPasswordLogin 未填写账号密码时提示', async () => {
    const { result } = renderLogin([xunleiAccount()]);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(result.current.xunleiLoginError).toBe('请填写迅雷账号和密码');
    expect(bridge.loginXunleiPassword).not.toHaveBeenCalled();
  });

  it('submitXunleiPasswordLogin 账号不存在时直接返回', async () => {
    const { result, rerender } = renderLogin([xunleiAccount()]);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    rerender({ accs: [], upd: vi.fn(), toast: () => {} });
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(bridge.loginXunleiPassword).not.toHaveBeenCalled();
  });

  it('submit 成功写回账号、关闭弹窗、toast', async () => {
    const update = vi.fn();
    const setToast = vi.fn();
    const { result } = renderLogin([xunleiAccount()], update, setToast);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(bridge.loginXunleiPassword).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' }), 'u', 'p', '');
    expect(update).toHaveBeenCalledWith('x1', expect.any(Function));
    const updater = update.mock.calls[0][1];
    expect(updater(xunleiAccount()).status).toBe('connected');
    expect(result.current.xunleiLoginAccountId).toBeNull();
    expect(setToast).toHaveBeenCalledWith({ message: '迅雷账号已登录', tone: 'success' });
  });

  it('submit 失败需二次验证：回填 reviewUrl/creditKey 并标记', async () => {
    bridge.loginXunleiPassword.mockRejectedValue({
      stage: 'xunlei_review',
      message: '需要验证',
      details: { reviewUrl: 'https://rev', creditKey: 'ck-1' },
    });
    const update = vi.fn();
    const { result } = renderLogin([xunleiAccount()], update);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(result.current.xunleiReviewUrl).toBe('https://rev');
    expect(result.current.xunleiCreditKey).toBe('ck-1');
    expect(result.current.xunleiLoginError).toContain('短信二次验证');
    expect(update.mock.calls.some((c) => c[0] === 'x1')).toBe(true);
    const reviewUpdater = update.mock.calls.find((c) => c[0] === 'x1')?.[1];
    expect(reviewUpdater?.(xunleiAccount()).status).toBe('manual_required');
    expect(reviewUpdater?.(xunleiAccount()).pendingReason).toBe('需要二次验证');
  });

  it('submit 失败无需验证：设置错误并标记', async () => {
    bridge.loginXunleiPassword.mockRejectedValue({ message: '密码错误' });
    const update = vi.fn();
    const { result } = renderLogin([xunleiAccount()], update);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(result.current.xunleiLoginError).toBe('密码错误');
    expect(result.current.xunleiReviewUrl).toBe('');
    const errUpdater = update.mock.calls[0]?.[1];
    expect(errUpdater?.(xunleiAccount()).status).toBe('manual_required');
    expect(errUpdater?.(xunleiAccount()).pendingReason).toBe('密码错误');
  });

  it('closeXunleiPasswordLogin 非保存态清空', () => {
    const { result } = renderLogin([xunleiAccount()]);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.closeXunleiPasswordLogin());
    expect(result.current.xunleiLoginAccountId).toBeNull();
    expect(result.current.xunleiUsername).toBe('');
  });

  it('closeXunleiPasswordLogin 保存态禁止关闭', async () => {
    bridge.loginXunleiPassword.mockReturnValue(new Promise(() => {}));
    const { result } = renderLogin([xunleiAccount()]);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.submitXunleiPasswordLogin();
    });
    expect(result.current.xunleiLoginSaving).toBe(true);
    act(() => result.current.closeXunleiPasswordLogin());
    expect(result.current.xunleiLoginAccountId).toBe('x1');
    pending!.catch(() => {});
  });

  it('clearXunleiLoginError 清空错误', async () => {
    const { result } = renderLogin([xunleiAccount()]);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    bridge.loginXunleiPassword.mockRejectedValueOnce({ message: '错' });
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(result.current.xunleiLoginError).toBe('错');
    act(() => result.current.clearXunleiLoginError());
    expect(result.current.xunleiLoginError).toBe('');
  });
});

describe('useXunleiLogin - 打开验证页', () => {
  it('无 reviewUrl 时直接返回', async () => {
    const { result } = renderLogin([xunleiAccount()]);
    await act(async () => {
      await result.current.openXunleiReviewUrl();
    });
    expect(bridge.openXunleiReviewWindow).not.toHaveBeenCalled();
  });

  it('成功打开验证页', async () => {
    const { result } = renderLogin([xunleiAccount()]);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    // 模拟二次验证回填 reviewUrl
    bridge.loginXunleiPassword.mockRejectedValueOnce({
      stage: 'xunlei_review',
      message: 'v',
      details: { reviewUrl: 'https://rev', creditKey: '' },
    });
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    bridge.openXunleiReviewWindow.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.openXunleiReviewUrl();
    });
    expect(bridge.openXunleiReviewWindow).toHaveBeenCalledWith('https://rev');
  });

  it('打开失败时复制链接并 toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const setToast = vi.fn();
    const { result } = renderLogin([xunleiAccount()], vi.fn(), setToast);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    bridge.loginXunleiPassword.mockRejectedValueOnce({
      stage: 'xunlei_review',
      message: 'v',
      details: { reviewUrl: 'https://rev', creditKey: '' },
    });
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    bridge.openXunleiReviewWindow.mockRejectedValue({ message: '打开失败' });
    await act(async () => {
      await result.current.openXunleiReviewUrl();
    });
    expect(writeText).toHaveBeenCalledWith('https://rev');
    expect(setToast).toHaveBeenCalledWith({ message: '验证页打开失败，链接已复制', tone: 'danger' });
  });

  it('打开失败且复制也失败时 toast 提示手动复制', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('no clipboard'));
    Object.assign(navigator, { clipboard: { writeText } });
    const setToast = vi.fn();
    const { result } = renderLogin([xunleiAccount()], vi.fn(), setToast);
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    bridge.loginXunleiPassword.mockRejectedValueOnce({
      stage: 'xunlei_review',
      message: 'v',
      details: { reviewUrl: 'https://rev', creditKey: '' },
    });
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    bridge.openXunleiReviewWindow.mockRejectedValue({ message: '打开失败' });
    await act(async () => {
      await result.current.openXunleiReviewUrl();
    });
    expect(setToast).toHaveBeenCalledWith({ message: '验证页打开失败，请手动复制链接', tone: 'danger' });
  });
});

describe('useXunleiLogin - 扫码轮询', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('轮询到 connected 写回账号并关闭弹窗', async () => {
    const update = vi.fn();
    const setToast = vi.fn();
    const { result } = renderLogin([xunleiAccount()], update, setToast);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    bridge.checkXunleiLogin.mockResolvedValue({ status: 'connected', result: { hasCredential: true, loginName: '雷', cookieCount: 1 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(update).toHaveBeenCalledWith('x1', expect.any(Function));
    expect(setToast).toHaveBeenCalledWith({ message: '迅雷账号已登录', tone: 'success' });
    expect(result.current.xunleiQrAccountId).toBeNull();
    const connUpdater = update.mock.calls[0][1];
    expect(connUpdater(xunleiAccount()).status).toBe('connected');
    expect(connUpdater(xunleiAccount()).hasCredential).toBe(true);
  });

  it('轮询未连接则继续排队', async () => {
    const { result } = renderLogin([xunleiAccount()]);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    bridge.checkXunleiLogin.mockResolvedValue({ status: 'pending' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.xunleiQrAccountId).toBe('x1');
    // 再次推进仍排队
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.xunleiQrAccountId).toBe('x1');
  });

  it('轮询出错设置错误并继续排队', async () => {
    const update = vi.fn();
    const { result } = renderLogin([xunleiAccount()], update);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    bridge.checkXunleiLogin.mockRejectedValue({ message: '网络异常' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.xunleiQrError).toBe('网络异常');
    expect(update).toHaveBeenCalledWith('x1', expect.any(Function));
    expect(result.current.xunleiQrAccountId).toBe('x1');
    const errUpdater = update.mock.calls[0][1];
    expect(errUpdater(xunleiAccount()).status).toBe('manual_required');
    expect(errUpdater(xunleiAccount()).pendingReason).toBe('网络异常');
  });

  it('轮询时账号已删除 -> 提前返回不发起检查', async () => {
    const update = vi.fn();
    const { result, rerender } = renderLogin([xunleiAccount()], update);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    // 账号在轮询期间被移除
    rerender({ accs: [], upd: update, toast: () => {} });
    bridge.checkXunleiLogin.mockResolvedValue({ status: 'pending' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(bridge.checkXunleiLogin).not.toHaveBeenCalled();
  });

  it('轮询成功返回前卸载组件 -> 成功回调提前返回', async () => {
    const update = vi.fn();
    const { result, unmount } = renderLogin([xunleiAccount()], update);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    let resolveCheck!: (v: unknown) => void;
    bridge.checkXunleiLogin.mockReturnValue(new Promise((resolve) => { resolveCheck = resolve; }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    unmount();
    await act(async () => {
      resolveCheck({ status: 'connected', result: { hasCredential: true, loginName: '雷', cookieCount: 1 } });
    });
    // stopped 后提前返回，不写回账号
    expect(update).not.toHaveBeenCalled();
  });

  it('轮询失败返回前卸载组件 -> 失败回调提前返回', async () => {
    const update = vi.fn();
    const { result, unmount } = renderLogin([xunleiAccount()], update);
    await act(async () => {
      await result.current.openXunleiAuthorization(xunleiAccount());
    });
    let rejectCheck!: (e: unknown) => void;
    bridge.checkXunleiLogin.mockReturnValue(new Promise((_resolve, reject) => { rejectCheck = reject; }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    unmount();
    await act(async () => {
      rejectCheck({ message: '网络异常' });
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('useXunleiLogin - 二次验证完成监听', () => {
  beforeEach(() => {
    bridge.isTauriRuntime.mockReturnValue(true);
  });

  it('桌面端注册 listen 监听', () => {
    renderLogin([xunleiAccount()]);
    expect(eventApi.listen).toHaveBeenCalledWith('xunlei-review-complete', expect.any(Function));
  });

  it('事件无 creditKey 且无登录弹窗时提示手动复制', async () => {
    const dispose = vi.fn();
    eventApi.listen.mockResolvedValue(dispose);
    const { result } = renderLogin([xunleiAccount()]);
    await waitFor(() => expect(eventApi.listen).toHaveBeenCalled());
    const handler = eventApi.listen.mock.calls[eventApi.listen.mock.calls.length - 1][1];
    await act(async () => {
      await handler({ payload: { windowLabel: 'l', creditKey: '' } });
    });
    expect(bridge.closeXunleiReviewWindow).toHaveBeenCalledWith('l');
    expect(result.current.xunleiLoginError).toContain('CreditKey');
  });

  it('事件带 creditKey 且处于二次验证流程时自动续登', async () => {
    const dispose = vi.fn();
    eventApi.listen.mockResolvedValue(dispose);
    const { result } = renderLogin([xunleiAccount()]);
    // 进入二次验证流程：先失败登录拿到 reviewUrl
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    bridge.loginXunleiPassword.mockRejectedValueOnce({
      stage: 'xunlei_review',
      message: 'v',
      details: { reviewUrl: 'https://rev', creditKey: '' },
    });
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(result.current.xunleiReviewUrl).toBe('https://rev');
    bridge.loginXunleiPassword.mockResolvedValue({ hasCredential: true, loginName: '雷2', cookieCount: 1 });
    const handler = eventApi.listen.mock.calls[eventApi.listen.mock.calls.length - 1][1];
    await act(async () => {
      await handler({ payload: { windowLabel: 'l', creditKey: 'ck-new' } });
    });
    await waitFor(() => expect(bridge.loginXunleiPassword).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' }), 'u', 'p', 'ck-new'));
    expect(result.current.xunleiLoginAccountId).toBeNull();
  });

  it('事件续登时账号已被删除 -> runPasswordLogin 提前返回（account guard L151-152）', async () => {
    const dispose = vi.fn();
    eventApi.listen.mockResolvedValue(dispose);
    const { result, rerender } = renderLogin([xunleiAccount()]);
    // 进入二次验证流程：先失败登录拿到 reviewUrl，置 xunleiLoginAccountId='x1'
    act(() => result.current.openXunleiPasswordLogin(xunleiAccount()));
    bridge.loginXunleiPassword.mockRejectedValueOnce({
      stage: 'xunlei_review',
      message: 'v',
      details: { reviewUrl: 'https://rev', creditKey: '' },
    });
    act(() => result.current.setXunleiUsername('u'));
    act(() => result.current.setXunleiPassword('p'));
    await act(async () => {
      await result.current.submitXunleiPasswordLogin();
    });
    expect(result.current.xunleiReviewUrl).toBe('https://rev');
    // 账号在二次验证期间被删除。review 监听 effect 不依赖 providerAccounts（见 L337 注释），
    // 故需改一次其依赖（xunleiPassword）以重建监听闭包，捕获已被清空的 providerAccounts。
    rerender({ accs: [], upd: vi.fn(), toast: () => {} });
    act(() => result.current.setXunleiPassword('p2'));
    // 之前 submitXunleiPasswordLogin 已调用过一次 loginXunleiPassword（review 失败），清掉以隔离续登调用
    bridge.loginXunleiPassword.mockClear();
    bridge.loginXunleiPassword.mockResolvedValue({ hasCredential: true, loginName: '雷2', cookieCount: 1 });
    const handler = eventApi.listen.mock.calls[eventApi.listen.mock.calls.length - 1][1];
    await act(async () => {
      await handler({ payload: { windowLabel: 'l', creditKey: 'ck-new' } });
    });
    // 闭包内 providerAccounts 已空 -> runPasswordLogin 找不到账号 -> 提前返回，不发起登录
    expect(bridge.loginXunleiPassword).not.toHaveBeenCalled();
    expect(result.current.xunleiLoginAccountId).toBe('x1');
    expect(result.current.xunleiLoginError).toBe('验证完成，正在自动继续登录……');
  });
});
