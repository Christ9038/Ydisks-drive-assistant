//! 轻提示域：持有 `toast` 状态并在 3.2s 后自动清除。
//!
//! 与其它业务状态无耦合的叶子域。调用方通过 `setToast` 推送一条提示，
//! hook 内部 effect 负责定时清除，`null` 表示无提示。

import { useEffect, useState } from 'react';

/** 轻提示状态：消息 + 语义色调。 */
export type ToastState = {
  message: string;
  tone: 'success' | 'danger' | 'info';
};

/** 轻提示 hook：返回当前提示与 setter；内部 effect 在 3200ms 后自动置空。 */
export function useToast(): { toast: ToastState | null; setToast: (toast: ToastState | null) => void } {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { toast, setToast };
}
