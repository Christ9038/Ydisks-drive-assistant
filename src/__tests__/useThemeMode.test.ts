import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThemeMode } from '../hooks/useThemeMode';
import { themeModeStorageKey } from '../lib/constants';

describe('useThemeMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-thememode');
    document.documentElement.style.colorScheme = '';
    vi.restoreAllMocks();
  });

  it('默认 system 并应用到 html + localStorage（matchMedia 不匹配 -> light）', () => {
    const { result } = renderHook(() => useThemeMode());
    expect(result.current.themeMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themeMode).toBe('system');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(window.localStorage.getItem(themeModeStorageKey)).toBe('system');
  });

  it('setThemeMode(dark) 应用并持久化', () => {
    const { result } = renderHook(() => useThemeMode());
    act(() => result.current.setThemeMode('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem(themeModeStorageKey)).toBe('dark');
  });

  it('setThemeMode(light) 应用 light', () => {
    const { result } = renderHook(() => useThemeMode());
    act(() => result.current.setThemeMode('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(themeModeStorageKey)).toBe('light');
  });

  it('system 模式注册 change 监听，切换到非 system 后清理', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList);

    const { result, unmount } = renderHook(() => useThemeMode());
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    // 切换到 dark：非 system -> effect 清理移除监听
    act(() => result.current.setThemeMode('dark'));
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
  });

  it('已存储 dark 时初始为 dark', () => {
    window.localStorage.setItem(themeModeStorageKey, 'dark');
    const { result } = renderHook(() => useThemeMode());
    expect(result.current.themeMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
