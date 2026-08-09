# 前端测试覆盖率报告

> 维护者参考。记录当前覆盖率与剩余未覆盖行的分类，便于后续判断是否需要调整。

## 当前覆盖率

| 指标 | 覆盖率 | 计数 |
|------|--------|------|
| Statements | **99.73%** | 4199 / 4210 |
| Branches | ~97.2% | — |
| Functions | ~95.8% | — |
| Lines | **99.73%** | 4199 / 4210 |

测试：531 个用例，27 个测试文件，全部通过（`npm test`）。

## 剩余未覆盖行（11 行）

以下行均为**真实不可达**的防御性守卫 / 框架级守卫 / 安全网，通过 UI 或单测无法触发，
移除会削弱代码的健壮性，故保留并在此说明。

| 文件 | 行 | 分类 | 说明 |
|------|----|------|------|
| `src/App.tsx` | 549 | 穷举 switch 默认分支 | `activePage` 是联合类型，导航只赋合法值；`default: return null` 是 TypeScript 穷举兜底，无法触发。 |
| `src/components/modals.tsx` | 346-347 | 边界守卫 | `jumpToCrumb(index)` 的 `if (!crumb) return`；面包屑仅以合法下标（`crumbs.map` 的 index）调用，越界不可达。 |
| `src/hooks/useBatchEngine.ts` | 308-309 | 去重安全网 | 短链 effect 的 `if (backendRequestsRef.has(key)) return`；因 322 行同步将状态置为 `creating_shortlink`，下一次 effect 前该项不再被 `findItemToShortlink` 选中，故去重分支当前不可达。保留作双发安全网（防止未来时序变更导致重复登记短链、浪费额度）。 |
| `src/hooks/useThemeMode.ts` | 24-25 | SSR 守卫 | `if (typeof window === 'undefined') return`；jsdom 环境下 `window` 必然存在，仅服务端渲染命中。本应用不走 SSR，但保留守卫以防误用。 |
| `src/hooks/useXunleiLogin.ts` | 151-152 | 账号不存在守卫 | `runPasswordLogin` 的 `if (!account || provider !== 'xunlei') return`；模态框提交路径 `submitXunleiPasswordLogin` 已在前置 205 行预检；二次验证监听器路径（330 行）因闭包捕获的是弹窗打开时的 `providerAccounts`（含该账号），陈旧闭包使此分支同样不可达。保留作防御。 |
| `src/pages/TasksPage.tsx` | 212-213 | 提交守卫 | `submitBatch` 的 `if (!canSubmit || !selectedProviderAccount) return`；提交按钮在 `!canSubmit` 时 `disabled`，而 `canSubmit` 已包含 `Boolean(selectedProviderAccount && …)`，故点击时两个条件恒为 false。保留作防御。 |

## 已移除的死代码

- `src/lib/engine.ts`：`advanceLocalBatch` 中 `completed === items.length ? '全部资源处理完成' : …` 三元——与 `batchToHistory`（`batchReducer.ts`）中相同的 `currentStep` 赋值重复，移除冗余分支。
- `src/hooks/useBatchEngine.ts`：去抖 effect 开头的 `if (batchSaveTimerRef.current !== null) clearTimeout(…)`——effect 清理函数（`return`）在每次 `batches` 变更前必然先 clear 并置空 ref，故开头的判空清理为死代码，移除。

## 提升覆盖率采用的技术

- **mock 子组件捕获 handler**（`app.handlers.test.tsx`）：mock `SettingsPage` 捕获 `onProvider*` 回调，以 UI 不会产生的入参（空名 / 不存在 ID / 人工构造的异常状态账号）直接调用，覆盖 `App.tsx` 中 `handleProviderAdd/Delete/Login/Check` 的防御性守卫（347-348、375-376、386-387、417-418、424-431、435-436）。
- **mock hook 强制渲染条件分支**（`app.xunleiQrModal.test.tsx`）：mock `useXunleiLogin` 返回已置位的 `xunleiQrAccount`，触发 `App.tsx` 659-667 的 `XunleiQrModal` 条件渲染（该弹窗在真实 UI 下因 `openXunleiAuthorization` 调用循环不可达）。
- **`render` + `StrictMode` 触发 effect 双调用**（`useApiConnection.test.ts`）：`renderHook` 不会触发 StrictMode 双调用，改用 `render` 渲染真实组件覆盖 ref 守卫（167-169）。
- **运行时切换 `isTauriRuntime` mock**（`app.test.tsx`）：桌面端加载历史后切为浏览器模式导出，覆盖浏览器端 CSV 下载回退分支（281）。
