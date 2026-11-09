# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ydisks批量转存助手 — a Tauri v2 desktop app for batch-transferring cloud drive shares (夸克/百度/迅雷网盘) and creating short links via a Ydisks backend API.

**Stack:** React 19 + TypeScript + Vite (frontend), Rust + Tokio + SQLite (backend), Tauri v2.

## Common Commands

| Task | Command |
|------|---------|
| Web dev (no Rust) | `npm run dev` — serves on `http://localhost:5178` |
| Desktop dev | `npm run tauri:dev` — builds Rust + launches app window |
| Web build | `npm run build` — runs `tsc && vite build`, outputs to `dist/` |
| Desktop build (macOS app) | `npm run tauri:build -- --bundles app` — builds release `.app` |
| Frontend tests | `npm test` — runs Vitest once (`npm run test:watch` to watch) |
| Backend tests | `cargo test` (run in `src-tauri/`) — unit + ignored live tests |
| Backend check | `cargo check` / `cargo build` (run in `src-tauri/`) |

**Note:** The frontend depends on Tauri APIs (`@tauri-apps/api/core`). Business features only work inside the desktop runtime. Browser dev never persists business data; `localStorage` is reserved for theme preference and one-time legacy migration reads.

## Architecture

### Frontend (`src/`)

- **`src/App.tsx`** (~700 lines) — thin App shell: page routing + modal orchestration + provider-account CRUD handlers (`handleProviderAdd/Login/Check/Clear/Delete`) + confirm-dialog state + account/theme persistence effects. All state-machine logic delegated to hooks. Pure logic lives in `src/lib/`, presentational/interactive components in `src/components/`, pages in `src/pages/`, state domains in `src/hooks/`. Pages receive data + callbacks via props from `App`.
- **`src/lib/`** — pure, tested modules:
  - `constants.ts` — platform keys, labels, status labels, default folder refs, storage keys.
  - `guards.ts` — type guards + judgments (`isProviderKey`, `isActiveQueueStatus`, `providerOfAccountTypeName`, `normalizeStoredProviderAccounts`, …).
  - `parsing.ts` — share-URL detection / access-code extraction / text & CSV resource parsing.
  - `csv.ts` — `buildHistoryCsv` + `csvEscape`.
  - `format.ts` — `formatBackendError` / `extractXunleiReviewState`.
  - `mappers.ts` — `ProviderAccount`↔`RustAccountRow`, `BatchRecord`↔`RustBatchRow`, `HistoryRecord`↔`RustHistoryRow`, `buildTargetsFromBackendAssets`.
  - `engine.ts` — local batch engine (`advanceLocalBatch`, `normalizePlatformQueues`, `createQueueItemsFromDraft`, factories).
  - `storage.ts` — theme persistence plus one-time readers/cleanup for legacy business data.
  - `bridge.ts` — typed `invoke` wrappers + persistence/asset/loading helpers + `isTauriRuntime` / `waitForNextPaint` / `downloadHistoryCsv` / `openLogDir`. The only frontend module that touches `@tauri-apps/api/core` directly.
  - `batchReducer.ts` — pure batch state-machine transitions (`reduceQueueItemUpdate` progress/status derivation, `reducePauseBatch`/`reduceContinueBatch`/`reduceRetryBatch`/`reduceRetryQueueItem`, `batchToHistory`, `hasSamePlatformBlocker`, `needsBackendRegistration`). Unit-tested; `App` calls these instead of inlining the logic.
  - `types.ts` — shared interfaces & Rust row types used across lib + components + pages.
- **`src/components/`** — reusable React components (presentational primitives in `ui.tsx` are `React.memo`-wrapped so the 1.6s engine poll doesn't re-render them when their primitive props are unchanged):
  - `ui.tsx` — primitives (`SectionTitle`, `Field`, `SelectField`, `ThemeModeControl`, `Metric`, `StatusPill`, `TaskPill`, `BatchStatusPill`, `Progress`, `Callout`, `EmptyState`).
  - `tables.tsx` — `ImportTable`, `QueueTable`, `BatchLogPanel`, `ResultsTable`.
  - `modals.tsx` — `ConfirmDialog`, `CookiePasteModal`, `XunleiQrModal`, `XunleiPasswordModal`, `FolderPickerModal`, `DirectorySelectField`.
  - `fields.tsx` — `ShortLinkTargets`.
- **`src/pages/`** — page components rendered by `App` via switch on `activePage`:
  - `TasksPage.tsx`, `StatusPage.tsx` (+ inline `BatchMonitorTable`, renders `BatchDetailPage.tsx`), `BatchDetailPage.tsx`, `HistoryPage.tsx`, `SettingsPage.tsx` (+ inline `ProviderAccountsPanel`/`ProviderCard`).
- **`src/hooks/`** — state domains extracted from `App` (each owns its slice of state + effects, coupled domains receive callbacks as params):
  - `useThemeMode.ts` — `themeMode` state + apply/persist effect.
  - `useToast.ts` — `toast` state + auto-dismiss effect (exports `ToastState`).
  - `useApiConnection.ts` — API key / connection status / quota / backend assets (accounts/channels/domains/shortlink targets) + `detectApiKey` / `setApiKeyDraft` / `clearApiKeyImmediately` + startup auto-detect. Takes `setToast`.
  - `useCookieModal.ts` — cookie-paste modal state + open/close/submit. Takes `providerAccounts` + `updateProviderAccount`.
  - `useXunleiLogin.ts` — 迅雷 scan-code + password-login modals (12 states) + 2s scan poll effect. Takes `providerAccounts` + `updateProviderAccount` + `setToast`.
  - `useBatchEngine.ts` — **core state machine**: owns `batches` / `histories` + the 1.6s poll, transfer (`transferProviderShare`), short-link (`createBackendLinks`), completion (→history), and SQLite persistence effects + `createBatch`/`pause`/`continue`/`retry`/`cancel` handlers. Decision rules ("which item to act on", "is batch complete") are pure predicates in `batchReducer.ts` (tested). Takes `providerAccounts` + `apiKey` + `updateProviderAccount` + `setToast` + `requestConfirm` + `onBatchCreated` (exports `ConfirmState`).
- **`src/types.ts`** — core domain types (`ProviderKey`, `TaskStatus`, `QueueItem`, `BatchMonitor`, …).
- **`src/styles.css`** — global CSS, no CSS-in-JS or Tailwind.
- **`src/lib/__tests__/`** + **`src/__tests__/`** — Vitest suites (pure-logic unit tests + component smoke tests).

**Pages** (rendered inside `App` via switch on `activePage`):
- `TasksPage` — create batch tasks: select provider account, import resources (single/paste/CSV), choose target folder, configure short-link targets, submit. The Ydisks backend account dropdown is filtered by selected cloud-drive type (夸克/百度/迅雷).
- `StatusPage` — monitor running/queued/paused batches; pause/continue/retry/cancel (cancel uses an in-app `ConfirmDialog`, not native `window.confirm`).
- `HistoryPage` — view completed/failed batch history; export CSV via native save dialog (`save_text_file_command`).
- `SettingsPage` — provider account management, API key connection (key persisted after a successful check; clear button removes it), theme toggle, open-log-dir button.

**Key frontend patterns:**
- API key stored under `ydisks.transfer.apiKey.v1` (saved on successful detection; clearable).
- Theme mode stored under `ydisks.transfer.themeMode.v1` (`light`/`dark`/`system`).
- Batches are processed by a local engine: `useEffect` interval every 1600ms advances queue items through states (`pending` → `transferring` → `sharing` → `creating_original` → `creating_shortlink` → `done`).
- Platform-level serialization: only one batch per provider (`quark`/`baidu`/`xunlei`) can be `running` at a time; others queue.
- **Transfer rate-limit (anti-throttling):** `useBatchEngine` enforces a configurable interval between `transferProviderShare` initiations per provider (`lastTransferStartedAtRef`, keyed by `ProviderKey`). Defaults are 4s for each platform and persisted settings are clamped to a 3s minimum. A throttled item is retried on the next 1.6s poll. The interval carries across batches but resets on app restart.
- **Quota refresh (optimistic + sync):** `useApiConnection` exposes `deductQuotaLocally(count)` and `syncQuotaFromBackend()`. After each `createBackendLinks` success, `useBatchEngine` calls `deductQuotaLocally(shortLinks.length)` so the displayed "剩余额度" drops immediately without hitting the backend (which would be too frequent during a batch). When a batch fully completes (all items `done`, moved to history), the completion effect calls `syncQuotaFromBackend()` once to reconcile the local optimistic count with the real backend value (corrects cumulative drift). Sync failures are silent (local optimistic value retained).
- **No-API-Key transfer (growth mode):** basic batch transfer does NOT require an API Key — only the drive login. `needsBackendRegistration(batch, apiKey)` (pure predicate in `batchReducer.ts`) returns false when `apiKey` is blank or the batch has no `ydisksAccountId`; in that case the transfer effect's `.then` sets the item straight to `done` (skipping `creating_original` / `createBackendLinks`), so the short-link effect never picks it up and the batch completes normally. `TasksPage` gates this in UI: when `ydisksAccounts` is empty (no backend), the Ydisks account `SelectField` and `ShortLinkTargets` are disabled and a `Callout` nudges the user to connect for short links; `canSubmit` no longer requires a backend account. Retry avoids duplicate transfers: `reduceRetryBatch`/`reduceRetryQueueItem` route items that already have `shareUrl` back to `creating_original` (resume from backend registration) instead of `pending` (re-transfer).
- Rust calls go through typed wrappers in `src/lib/bridge.ts` (not raw `invoke`), each guarded by `isTauriRuntime()` with errors normalized via `formatBackendError()`. `App.tsx` and components import these wrappers rather than calling `invoke` directly.
- Event `provider-login-complete` is listened to for async login completion from popup windows.
- Event `xunlei-review-complete` is listened to by `useXunleiLogin` for automatic resumption after Xunlei secondary verification (creditKey auto-filled → window closed → login retried).

### Backend (`src-tauri/src/`)

Modular Rust backend. `lib.rs` only wires plugins + `generate_handler!`; all `#[tauri::command]` functions live in `commands.rs` as thin wrappers over business modules. **32 commands** are registered.

Module layout:
- `commands.rs` — 32 `#[tauri::command]` wrappers + `with_db` helper.
- `types.rs` — domain enums/structs (fully documented).
- `error.rs` — `BackendClientError` + `backend_error` / `backend_error_with_details`.
- `config.rs` — URLs, 迅雷 SDK constants, injected JS init scripts.
- `logging.rs` — `tauri-plugin-log` plugin (level fixed at startup: `Info`).
- `http/client.rs` — reqwest singleton + JSON/URL/cookie helpers + HTTP request variants.
- `import/parser.rs` — share-URL parsing, access-code extraction, dedupe, quota plan.
- `auth/` — login window orchestration + cookie/token capture (`mod.rs`, `windows.rs`).
- `backend/` — Ydisks console API client (`client.rs`, `assets.rs`, `links.rs`).
- `providers/` — 夸克/百度/迅雷 transfer & folder listing (`mod.rs`, `folders.rs`, `baidu.rs`, `quark.rs`, `xunlei/` dir module with `mod.rs` + `util.rs` pure hashing/signing helpers).
- `db/` — SQLite persistence (`mod.rs` `DbState`/`init_db`/`migrate`, `schema.rs`, `models.rs`, `account_repo.rs`, `batch_repo.rs`).

**Command domains:**
- Import & quota: `parse_import_text_command`, `parse_import_csv_command`, `build_original_link_payload_command`, `build_short_link_payloads_command`, `preview_quota`.
- Backend API: `fetch_backend_assets_command`, `fetch_backend_quota_command`, `create_backend_links_command`.
- Login: `open_quark_login_window_command`, `capture_quark_login_cookie_command`, `check_quark_cookie_command`, `open_provider_login_window_command`, `open_xunlei_review_window_command`, `start_xunlei_login_command`, `check_xunlei_login_command`, `login_xunlei_password_command`, `capture_provider_login_command`, `check_provider_login_command`.
- Transfer & folders: `list_provider_folders_command`, `transfer_quark_share_command`, `transfer_share_command`.
- Persistence (SQLite): `list_provider_accounts_command`, `upsert_provider_account_command`, `delete_provider_account_command`, `import_legacy_accounts_command`, `save_batch_command`, `load_batches_command`, `delete_batch_command`, `save_history_command`, `load_history_command`.
- Utilities: `save_text_file_command` (native save dialog), `open_log_dir_command` (open log dir in file manager).

**Constants:**
- Console API base: `https://console.ydisks.com` (env-overridable via `console_api_base()`).
- Quark login URL: `https://pan.quark.cn/`; Baidu login URL: `https://pan.baidu.com/`.
- Xunlei API base: `https://api-pan.xunlei.com/drive/v1`.

### Tauri Configuration

- `src-tauri/tauri.conf.json` — window size 1360×860, min 1080×720. Production CSP enabled (`default-src 'self'`; Tauri auto-injects nonces/hashes at compile time; dev server origin auto-allowed).
- `src-tauri/capabilities/default.json` — `core:default` + `dialog:allow-save`.
- Dev server port is fixed at `5178` (`vite.config.ts`).

## Important Code Patterns

### Adding a new Tauri command

1. Implement the business logic in the appropriate module under `src-tauri/src/` (e.g. `providers/`, `backend/`, `db/`).
2. Add a thin `#[tauri::command]` wrapper in `src-tauri/src/commands.rs`.
3. Register it in the `tauri::generate_handler![...]` list in `lib.rs` `run()`.
4. In frontend, define the Rust return type (prefix `Rust`, e.g. `RustQuarkTransferResult`) in `src/lib/types.ts`.
5. Call via `invoke<Type>('command_name', { args })` inside an `isTauriRuntime()` guard; format errors with `formatBackendError()`.

### Persistence (backend config + SQLite + localStorage migration)

On desktop, non-secret runtime parameters with defaults (currently per-provider transfer intervals) live in the Rust-managed `config.json`; a missing file is generated automatically, writes are atomic, and successful updates are reloaded into backend memory. Account credentials, API Key, batches and history remain in SQLite via `db/` repos. Rust returns only `hasCredential` / `hasApiKey` flags to the UI. Legacy database/localStorage settings are imported once and removed. Browser dev has no business-data persistence.

### Hard rule: API-only, never HTML-based logic

**永远不要把功能逻辑建立在解析 HTML 上。** 网盘功能（读分享列表、转存、建分享、登录态校验等）必须基于 JSON/表单 API。HTML 页面结构随时会变，一变软件就失效，造成维护地狱（百度分享页 `locals.mset` 改版导致转存失败即是先例，已改用 `share/list` 接口并删除页面抓取）。

- 禁止：正则/字符串截取页面内嵌脚本（`locals.mset`、`yunData` 等）、抓页面拿数据、以页面 DOM 为前提的注入脚本驱动业务流程。
- 允许：登录窗口仅用于让用户登录并采集 Cookie；业务数据一律走 API。
- 遇到 API 不可用时，找另一个 API，不要回退到 HTML 抓取作为"兜底"。

### Error handling convention

Backend errors are formatted via `formatBackendError()` (in `src/lib/format.ts`) which reads `{ message, stage, code, details }` from Rust. Errors with `stage: 'xunlei_review'` or code `1007` trigger a review flow (`extractXunleiReviewState`).

### State management

All UI state is local React state in `App.tsx`. No external state library. Data flows:
- `ProviderAccount[]` → sanitized UI projection of SQLite rows; Cookie/Token never enters React state.
- `BatchRecord[]` / `HistoryRecord[]` → persisted to SQLite (desktop); ephemeral in browser dev.
- `QuotaState` / `ShortLinkTarget[]` / `YdisksAccountOption[]` — fetched from backend API on demand.

### Testing

- **Backend:** `#[cfg(test)] mod tests` in each module; pure-function unit tests cover parsing, crypto/signing, URL/cookie helpers, DB repos, folder collection. Live network tests are `#[ignore]` (run with `cargo test -- --ignored` + env vars like `YDISKS_LIVE_BAIDU_COOKIE`). Dev-dep: `pretty_assertions`.
- **Frontend:** Vitest + jsdom + @testing-library/react. Pure-logic suites under `src/lib/__tests__/` mirror the Rust parser tests; component smoke tests under `src/__tests__/`. `src/test/setup.ts` polyfills `localStorage` and `matchMedia`.

## File locations to know

| Purpose | Path |
|---------|------|
| Frontend entry | `src/main.tsx` |
| App component (orchestration root) | `src/App.tsx` |
| Pure logic modules | `src/lib/*.ts` (incl. `bridge.ts`) |
| Reusable components | `src/components/*.tsx` |
| Page components | `src/pages/*.tsx` |
| Leaf state hooks | `src/hooks/*.ts` |
| Shared types | `src/types.ts`, `src/lib/types.ts` |
| Frontend tests | `src/lib/__tests__/`, `src/__tests__/`, `src/test/setup.ts` |
| Styles | `src/styles.css` |
| Rust lib entry | `src-tauri/src/lib.rs` |
| Rust commands | `src-tauri/src/commands.rs` |
| Rust main | `src-tauri/src/main.rs` |
| Tauri config | `src-tauri/tauri.conf.json` |
| Capabilities | `src-tauri/capabilities/default.json` |
| Cargo manifest | `src-tauri/Cargo.toml` |
| Vite config | `vite.config.ts` |
| Icons | `src-tauri/icons/` |
| CI workflow | `.github/workflows/build.yml` |
| CI/release scripts | `scripts/`（`version.mjs` 版本推导、`inject_dmg_extra.sh` DMG 注入、`macos-unblock.command` 免证书修复） |
| CI 运维文档 | `docs/CI.md`（面向维护者：发版操作、版本规则、故障排查） |
