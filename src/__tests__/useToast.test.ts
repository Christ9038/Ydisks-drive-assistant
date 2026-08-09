import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '../hooks/useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始为 null', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it('setToast 设置提示并在 3200ms 后自动清除', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast({ message: '成功', tone: 'success' }));
    expect(result.current.toast).toEqual({ message: '成功', tone: 'success' });
    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(result.current.toast).toBeNull();
  });

  it('设置为 null 时不安排定时器', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast(null));
    expect(result.current.toast).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.toast).toBeNull();
  });

  it('新提示会重置定时器（先清除旧 timer）', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast({ message: '一', tone: 'info' }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => result.current.setToast({ message: '二', tone: 'danger' }));
    // 距第一条已过 2s，但定时器以第二条为起点，此处不应清除
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).toEqual({ message: '二', tone: 'danger' });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(result.current.toast).toBeNull();
  });
});
