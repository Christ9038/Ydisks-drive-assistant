import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCookieModal } from '../hooks/useCookieModal';
import type { ProviderAccount } from '../types';

const account = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'a1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主账号',
  status: 'expired',
  loginName: '',
  purpose: '转存',
  lastChecked: '',
  hasCredential: true,
  ...over,
});

describe('useCookieModal', () => {
  it('打开弹窗不回显 Rust 保存的 cookie', () => {
    const { result } = renderHook(() => useCookieModal([account()], vi.fn()));
    act(() => result.current.openCookieModal('a1'));
    expect(result.current.cookieModalAccount?.id).toBe('a1');
    expect(result.current.cookieDraft).toBe('');
    expect(result.current.isCookieModalOpenFor('a1')).toBe(true);
  });

  it('打开不存在的账号无副作用', () => {
    const { result } = renderHook(() => useCookieModal([account()], vi.fn()));
    act(() => result.current.openCookieModal('nope'));
    expect(result.current.cookieModalAccount).toBeUndefined();
    expect(result.current.isCookieModalOpenFor('nope')).toBe(false);
  });

  it('账号无 cookie 时预填空串', () => {
    const { result } = renderHook(() => useCookieModal([account({ hasCredential: false })], vi.fn()));
    act(() => result.current.openCookieModal('a1'));
    expect(result.current.cookieDraft).toBe('');
  });

  it('非 saving 态关闭弹窗清空', () => {
    const { result } = renderHook(() => useCookieModal([account()], vi.fn()));
    act(() => result.current.openCookieModal('a1'));
    act(() => result.current.closeCookieModal());
    expect(result.current.cookieModalAccount).toBeUndefined();
    expect(result.current.cookieDraft).toBe('');
    expect(result.current.cookieError).toBe('');
  });

  it('resetCookieModal 强制清空（无视 saving）', () => {
    const { result } = renderHook(() => useCookieModal([account()], vi.fn()));
    act(() => result.current.openCookieModal('a1'));
    act(() => result.current.resetCookieModal());
    expect(result.current.cookieModalAccount).toBeUndefined();
  });

  it('setCookieDraft / setCookieError 受控', () => {
    const { result } = renderHook(() => useCookieModal([account()], vi.fn()));
    act(() => result.current.setCookieDraft('new-val'));
    act(() => result.current.setCookieError('出错了'));
    expect(result.current.cookieDraft).toBe('new-val');
    expect(result.current.cookieError).toBe('出错了');
  });

  it('提交空 cookie 时设置错误', async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useCookieModal([account({ hasCredential: false })], update));
    act(() => result.current.openCookieModal('a1'));
    await act(async () => {
      await result.current.submitCookieModal();
    });
    expect(result.current.cookieError).toBe('请粘贴完整 Cookie');
    expect(update).not.toHaveBeenCalled();
  });

  it('提交成功更新账号并关闭弹窗', async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useCookieModal([account()], update));
    act(() => result.current.openCookieModal('a1'));
    act(() => result.current.setCookieDraft('new-cookie'));
    await act(async () => {
      await result.current.submitCookieModal();
    });
    expect(update).toHaveBeenCalledWith('a1', expect.any(Function));
    // 验证 updater 逻辑
    const updater = update.mock.calls[0][1];
    const updated = updater(account());
    expect(updated.hasCredential).toBe(true);
    expect(updated.status).toBe('connected');
    expect(updated.loginName).toBe('夸克已登录账号');
    expect(updated.pendingReason).toBeUndefined();
    expect(result.current.cookieModalAccount).toBeUndefined();
    expect(result.current.cookieSaving).toBe(false);
  });

  it('提交时账号已不存在则直接返回', async () => {
    const update = vi.fn();
    const { result, rerender } = renderHook(({ accounts }: { accounts: ProviderAccount[] }) => useCookieModal(accounts, update), {
      initialProps: { accounts: [account()] },
    });
    act(() => result.current.openCookieModal('a1'));
    act(() => result.current.setCookieDraft('new-cookie'));
    // 账号被删除后重渲染
    rerender({ accounts: [] });
    await act(async () => {
      await result.current.submitCookieModal();
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('更新展示状态异常时也会结束 saving 并显示错误', async () => {
    const update = vi.fn(() => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useCookieModal([account()], update));
    act(() => result.current.openCookieModal('a1'));
    act(() => result.current.setCookieDraft('new-cookie'));
    await act(async () => {
      await result.current.submitCookieModal();
    });
    expect(result.current.cookieSaving).toBe(false);
    expect(result.current.cookieError).toBe('boom');
    act(() => result.current.closeCookieModal());
    expect(result.current.cookieDraft).toBe('');
    // reset 仍可强制清空
    act(() => result.current.resetCookieModal());
    expect(result.current.cookieModalAccount).toBeUndefined();
  });
});
