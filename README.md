# Ydisks批量转存助手

批量转存夸克 / 百度 / 迅雷网盘分享链接，并通过 Ydisks 后台 API 一键创建多渠道短链的 Tauri v2 桌面应用。

## 技术栈

- **前端：** React 19 + TypeScript + Vite
- **后端：** Rust + Tokio + SQLite (rusqlite) + tauri-plugin-log/dialog
- **壳：** Tauri v2

## 常用命令

| 任务 | 命令 |
|------|------|
| Web 开发（不含 Rust） | `npm run dev` — `http://localhost:5178` |
| 桌面开发 | `npm run tauri:dev` — 编译 Rust 并启动应用窗口 |
| Web 构建 | `npm run build` — `tsc && vite build`，产物在 `dist/` |
| 桌面构建（macOS .app） | `npm run tauri:build -- --bundles app` |
| 前端测试 | `npm test`（监听模式 `npm run test:watch`） |
| 后端测试 | 在 `src-tauri/` 下 `cargo test` |
| 后端编译检查 | 在 `src-tauri/` 下 `cargo check` |

> 许多功能（网盘登录、转存、目录读取、后台 API）依赖 Tauri 桌面运行时。浏览器 `npm run dev` 下 `isTauriRuntime()` 为 false，相关操作会提示「请在桌面端运行」，持久化也会退回到浏览器 `localStorage`。

## 架构概览

### 前端 `src/`

- `App.tsx` — 应用外壳、四个页面（任务 / 状态 / 历史 / 设置）、子组件、状态机与 Rust `invoke` 桥接层。
- `src/lib/` — 已抽离并带单测的纯逻辑模块：`constants` / `guards` / `parsing` / `csv` / `format` / `mappers` / `engine` / `storage` / `types`。
- `src/types.ts` — 核心领域类型。

### 后端 `src-tauri/src/`

`lib.rs` 仅装配插件与 `generate_handler!`，32 个 `#[tauri::command]` 收纳在 `commands.rs`，业务逻辑分布在：

| 模块 | 职责 |
|------|------|
| `import/parser.rs` | 分享链接解析、提取码提取、去重、额度测算 |
| `auth/` | 登录窗口编排与 Cookie / token 抓取 |
| `backend/` | Ydisks 后台 API 客户端（资产 / 额度 / 短链） |
| `providers/` | 夸克 / 百度 / 迅雷 转存与目录列举 |
| `http/client.rs` | reqwest 单例 + JSON / URL / cookie 工具 |
| `db/` | SQLite 持久化（账号 / 批次 / 历史，含版本化迁移） |
| `error.rs` / `config.rs` / `logging.rs` | 错误、常量、日志 |

## 持久化

桌面端账号 / 批次 / 历史写入 SQLite（启动时 `init_db` + `migrate`），首次运行会从旧 `localStorage` 一次性迁移账号。浏览器开发环境退回 `localStorage`（仅账号），批次与历史为内存态。API Key 在检测通过后保存，可在设置页清除。主题模式保存在 `localStorage`。

## 跨平台日志

日志由 `tauri-plugin-log` 写入各平台标准日志目录（macOS `~/Library/Logs/...`、Windows `%LOCALAPPDATA%\...\logs`、Linux `~/.local/share/.../logs`），级别在启动时固定为 `Info`，设置页「打开日志目录」通过 `open_log_dir_command` 用系统文件管理器打开。

## 测试

- **后端：** 每个模块内 `#[cfg(test)]` 纯函数单测；真实网络用例以 `#[ignore]` 标记（`cargo test -- --ignored`，需设置 `YDISKS_LIVE_*` 环境变量）。
- **前端：** Vitest + jsdom + @testing-library/react。`src/lib/__tests__/` 覆盖解析 / CSV / 格式 / 映射 / 守卫 / 引擎 / 存储纯逻辑；`src/__tests__/` 为组件冒烟测试。

## 更多文档

产品设计 / UI / 流程 / 测试规格见仓库根的 `docs/TransferAssistant/`（PRD / UI / FLOW / TEST / ADD）。
