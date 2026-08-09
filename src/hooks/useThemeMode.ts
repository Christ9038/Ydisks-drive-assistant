//! 主题模式域：持有 `themeMode` 状态并负责将其应用到 `<html>` 与持久化。
//!
//! 这是与其它业务状态无耦合的叶子域：仅依赖 storage 读写与 `matchMedia`。
//! `system` 模式下监听系统配色变化实时切换。

import { useEffect, useState } from 'react';

import { themeModeStorageKey } from '../lib/constants';
import { loadStoredThemeMode, resolveThemeMode } from '../lib/storage';
import type { ThemeMode } from '../lib/types';

/**
 * 主题模式 hook：返回当前模式与切换函数；内部 effect 负责应用与持久化。
 *
 * - 将 `data-theme` / `data-themeMode` / `colorScheme` 写入 `<html>`；
 * - 同步写入 `localStorage`；
 * - `system` 模式下监听 `prefers-color-scheme` 变化。
 */
export function useThemeMode(): { themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void } {
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadStoredThemeMode);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolvedTheme = resolveThemeMode(themeMode);
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = themeMode;
      document.documentElement.style.colorScheme = resolvedTheme;
      window.localStorage.setItem(themeModeStorageKey, themeMode);
    };

    applyTheme();

    if (themeMode !== 'system') {
      return undefined;
    }

    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [themeMode]);

  return { themeMode, setThemeMode };
}
