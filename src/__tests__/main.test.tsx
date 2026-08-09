//! main.tsx 入口测试：验证将 <App /> 挂载到 #root。
//!
//! main.tsx 是副作用模块（import 即执行 createRoot().render），故 mock 掉
//! react-dom/client 与 App，在准备好 #root 后动态 import 触发执行。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  default: { createRoot: (...args: unknown[]) => mocks.createRoot(...args) },
  createRoot: (...args: unknown[]) => mocks.createRoot(...args),
}));

vi.mock('../App', () => ({
  default: () => null,
  // 重新导出的具名导出（main 不使用，但 App 模块本身有 re-export）
  SelectField: () => null,
  ThemeModeControl: () => null,
  ConfirmDialog: () => null,
}));

describe('main.tsx', () => {
  beforeEach(() => {
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    mocks.createRoot.mockClear();
    mocks.render.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
  });

  it('createRoot 挂载到 #root 并渲染', async () => {
    await import('../main');
    expect(mocks.createRoot).toHaveBeenCalledTimes(1);
    expect(mocks.createRoot.mock.calls[0][0]).toBe(document.getElementById('root'));
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });
});
