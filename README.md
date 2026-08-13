<div align="center">

# Ydisks 批量转存助手

**批量转存夸克 / 百度 / 迅雷网盘分享链接，并通过 [Ydisks](https://www.ydisks.com) 后台 API 一键创建多渠道短链的桌面应用。**

Tauri v2 · React 19 + TypeScript · Rust + Tokio + SQLite

[功能特性](#-功能特性) · [快速开始](#-快速开始) · [使用指南](#-使用指南) · [开发](#-开发) · [构建发布](#-构建发布) · [架构](#-架构概览) · [许可证](#-许可证)

</div>

---

## 📌 项目简介

Ydisks 批量转存助手是一款跨平台桌面应用（macOS / Windows），用于把分散的网盘分享链接**批量转存**到自己的网盘账号，并自动调用 [Ydisks 统计平台](https://www.ydisks.com) 的后台 API 为转存后的资源**批量生成多渠道短链**（小红书、抖音等渠道，可选多个短链域名）。

适合需要把大量分享链接整理转存并分发到多个推广渠道的场景：导入 → 转存 → 创建短链，全程自动化，支持限流、断点续传、失败重试。

> ✅ **无需 API Key 即可使用基本功能：** 网盘批量转存（导入分享链接 -> 转存到自己的网盘）只依赖你自己的网盘账号登录态，**不依赖 Ydisks**。开箱即用，无需注册、无需密钥。
>
> 🔗 **短链为高阶能力：** 转存后自动创建多渠道短链（小红书 / 抖音等）依赖 [Ydisks 统计平台](https://www.ydisks.com) 后台 API。需要短链时，在设置页连接 API Key 即可解锁——未连接时任务页的「后台账号」「多渠道短链」自动禁用，转存正常进行，仅跳过短链。详见 [配置 Ydisks API Key](#3-配置-ydisks-api-key)。

---

## ✨ 功能特性

- 🔄 **批量转存** — 支持夸克、百度、迅雷三种网盘，单条 / 批量粘贴 / CSV 导入分享链接，自动识别平台、提取访问码、去重。
- 🔗 **多渠道短链** — 转存完成后自动调用 Ydisks 后台创建原始链接，并按所选渠道逐个生成短链，支持多短链域名。
- 🧠 **智能状态机** — 本地引擎驱动批次流转（`pending → transferring → sharing → creating_original → creating_shortlink → done`），平台级串行化（同一网盘同时只跑一个批次）。
- ⏱️ **反限流** — 转存发起间隔默认 4 秒，可按网盘平台配置（最低 3 秒，跨批次生效），间隔期由短链创建填充。
- ⏸️ **暂停 / 继续 / 重试 / 取消** — 批次与单条粒度的控制；取消使用应用内确认弹窗，不弹原生 `confirm`。
- 💾 **分层持久化** — 转存间隔等具备默认值的运行参数由 Rust 写入 `config.json`，文件缺失时自动生成；账号凭证、API Key、批次与历史写入 SQLite。前端只保存主题偏好，首次运行会自动迁移旧数据。
- 📊 **额度管理** — 短链额度本地乐观扣减 + 批次完成后与后台同步，避免高频轮询。
- 🌗 **明暗主题** — 跟随系统 / 浅色 / 深色。
- 📝 **可导出历史** — 完成批次可导出 CSV（系统原生保存对话框）。
- 📋 **跨平台日志** — `tauri-plugin-log` 写入各平台标准日志目录，设置页一键打开。

---

## 🚀 快速开始

### 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| [Node.js](https://nodejs.org/) | 20+ | 推荐 LTS；含 npm |
| [Rust](https://www.rust-lang.org/) | 1.75+ | `rustup` 安装，stable 通道 |
| 系统依赖 | — | macOS 需 Xcode CLT；Windows 需 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) + MSVC 构建工具 |

> Tauri v2 的完整系统前置条件见官方文档：<https://v2.tauri.app/start/prerequisites/>

### 克隆并安装

```bash
git clone <仓库地址>
cd transfer-assistant
npm install            # 安装前端依赖
```

Rust 依赖在首次 `npm run tauri:dev` / `tauri:build` 时由 Cargo 自动拉取。

### 桌面开发模式

```bash
npm run tauri:dev      # 编译 Rust + 启动应用窗口（前端热更新）
```

> ℹ️ `npm run dev` 可单独启动前端（`http://localhost:5178`），但**仅用于纯前端调试**：浏览器中 `isTauriRuntime()` 为 false，网盘登录 / 转存 / 目录读取 / 后台 API 均不可用，也不会持久化任何业务配置。完整功能请在桌面端运行。

---

## 📖 使用指南

应用分四个页面：**任务 / 状态 / 历史 / 设置**。下面按首次使用顺序说明。

### 1. 下载安装

从 GitHub Releases 下载对应平台的安装包。本项目不购买 Apple / Microsoft 的公开代码签名证书。Windows 安装包使用 OpenSSL 生成的自签名证书，macOS 安装包使用 ad-hoc 签名；这些签名不能消除系统对未知发布者的提示。

**macOS** - 下载 `.dmg`，把应用拖到「应用程序」。首次打开会被 Gatekeeper 拦截，任选一种解除（推荐第 1 种）：

1. **双击修复脚本（最省事）** - 打开 `.dmg` 后，里面除应用外还附带一个 `macos-unblock.command`。先把应用拖到「应用程序」，再双击 DMG 里的这个脚本，自动清除隔离属性并打开应用。（脚本随 DMG 一并提供，无需单独下载。）
2. **终端一行命令**：
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Ydisks批量转存助手.app"
   ```
3. **系统设置** - 先双击应用触发拦截提示，再进「系统设置 -> 隐私与安全性 -> 仍要打开」。（macOS 15 Sequoia 起，右键 -> 打开 已不再可靠，请用上述方式。）

**Windows** - 运行 `.msi`（安装版）或 `.exe`（NSIS 安装包）。SmartScreen 提示「Windows 保护了你的电脑」时，点「**更多信息 -> 仍要运行**」（一次性，2 次点击）。这是未签名包的正常现象，不影响使用。

> 自行构建安装包见 [构建发布](#-构建发布)。

### 2. 登录网盘账号（设置 → 账号管理）

在**设置页**为夸克 / 百度 / 迅雷分别添加账号并完成登录：

| 网盘 | 登录方式 |
|------|---------|
| **夸克** | 弹出官方登录窗口扫码 / 账号登录，自动抓取 Cookie；也支持手动粘贴 Cookie |
| **百度** | 弹出官方登录窗口，或手动粘贴 Cookie |
| **迅雷** | 应用内扫码登录或账号密码登录；若触发二次验证（短信 / 滑块），应用会自动打开验证窗口，验证通过后自动继续登录 |

登录成功后账号卡片显示「已登录」。Cookie 会过期，过期后状态变为「登录过期」，重新登录或更新 Cookie 即可。每个账号支持「检测 / 粘贴 Cookie / 清理会话 / 删除」操作。

### 3. 配置 Ydisks API Key（可选 · 设置 -> 连接状态）

> 这一步是**可选**的。不配置 API Key 也能完成完整的批量转存流程，只是不会创建短链。仅当你需要「转存后自动生成多渠道短链」时才需配置。

短链功能依赖 Ydisks 后台，配置 API Key 步骤：

1. 前往 [Ydisks 统计平台](https://www.ydisks.com) 注册账号，在控制台获取 **API Key**，并确认已开通短链额度（短链上限 / 已用 / 剩余）。
2. 在应用**设置页 → 后台 → 连接状态**，输入 API Key，点「**检测连接**」。
3. 检测通过后，应用会自动拉取后台资产：
   - **推广账号**（按网盘类型分类，用于创建原始链接）
   - **渠道**（小红书 / 抖音 等，用于生成不同渠道短链）
   - **可用域名**（短链域名，如 `t.ydisks.cn`）
   - **额度摘要**（剩余短链数）

API Key 检测通过后由 Rust 保存到应用 SQLite，前端会立即清空明文输入，也不会在后续业务命令中传递密钥；下次启动通过后端返回的脱敏状态自动恢复连接。「清除密钥」会删除后端保存值。

> **后端地址可覆盖：** 默认后台地址为 `https://console.ydisks.com`。如需指向自建 / 测试环境，设置环境变量 `YDISKS_CONSOLE_API_BASE` 后启动应用即可。

### 4. 创建转存任务（任务页）

1. **选择网盘账号** - 下拉选择已登录的夸克 / 百度 / 迅雷账号。若已连接后台，「Ydisks 后台账号」下拉会按所选网盘类型自动过滤；**未连接后台时该下拉禁用，仅转存模式**。
2. **导入资源** — 三种方式：
   - **单条**：直接粘贴一条分享链接（含访问码）。
   - **批量粘贴**：多行文本，每行一条链接，可附带标题与提取码（如 `链接 提取码:9x8y`）。
   - **CSV 导入**：按模板上传 CSV。

   应用会自动识别网盘平台（`pan.quark.cn` / `pan.baidu.com` / `pan.xunlei.com` / `cloud.xunlei.com`）、提取 4 位访问码（支持「提取码 / 访问码 / 密码 / pwd / code」标签）、为百度链接补 `pwd=` 参数、去重。
3. **选择目标目录** — 在网盘内选择转存目标文件夹。
4. **配置短链目标（可选）** - 已连接后台时，勾选需要生成短链的渠道并为每个渠道选择短链域名；**未连接后台时此区域禁用**，提示前往设置连接 API Key，转存照常进行。
5. **提交** - 进入状态页监控。仅转存模式下，每条资源转存完成即标记完成，无需后台登记。

### 5. 监控批次（状态页）

- 查看运行中 / 排队 / 暂停的批次，实时进度与日志。
- 支持 **暂停 / 继续 / 重试 / 取消**（取消有应用内确认弹窗）。
- 每个队列项流转：`转存中 → 分享中 → 创建原始链接 → 创建短链 → 完成`。
- 同一网盘平台同时只跑一个批次，其余排队；转存发起间隔默认 4 秒，可在设置中按平台调整，最低 3 秒。

### 6. 查看历史与导出（历史页）

- 已完成 / 失败的批次归档于此。
- 点「导出 CSV」通过系统原生保存对话框导出，字段含批次信息、每条资源的状态与短链结果。

---

## 🔌 Ydisks 后台 API 说明

应用通过 `X-API-Key` 头调用 Ydisks 后台，响应统一为 `{ code, message, data }` 信封（`code == 0` 为成功）。涉及的接口：

| 用途 | 方法 | 路径 |
|------|------|------|
| 短链额度 | `GET` | `/api/v1/assets/quotas` |
| 推广账号 | `GET` | `/api/v1/assets/accounts?page=1&page_size=100` |
| 渠道列表 | `GET` | `/api/v1/assets/channels?page=1&page_size=200` |
| 可用域名 | `GET` | `/api/v1/assets/domains/available` |
| 创建原始链接 | `POST` | `/api/v1/assets/accounts/{accountId}/original-links` |
| 创建短链 | `POST` | `/api/v1/assets/links` |

接口契约细节（请求体字段、返回结构）见源码 `src-tauri/src/backend/`（`client.rs` / `assets.rs` / `links.rs`）与类型定义 `src-tauri/src/types.rs`。完整 API 文档以 [Ydisks 平台](https://www.ydisks.com) 控制台为准。

> 这些接口由 Ydisks 平台提供并维护，本应用仅作为客户端调用。接口的可用性、额度计费、字段变更等均由 Ydisks 平台决定。

---

## 🛠 开发

### 常用命令

| 任务 | 命令 |
|------|------|
| 桌面开发 | `npm run tauri:dev` |
| 纯前端开发 | `npm run dev`（`http://localhost:5178`，功能受限） |
| 前端类型检查 + 构建 | `npm run build`（`tsc && vite build`，产物 `dist/`） |
| 前端测试 | `npm test`（监听 `npm run test:watch`） |
| 后端编译检查 | `cargo check`（在 `src-tauri/` 下） |
| 后端测试 | `cargo test`（在 `src-tauri/` 下） |
| 后端真实网络测试 | `cargo test -- --ignored`（需设 `YDISKS_LIVE_*` 环境变量） |

### 测试

- **前端：** Vitest + jsdom + @testing-library/react。`src/lib/__tests__/` 覆盖解析 / CSV / 格式 / 映射 / 守卫 / 引擎 / 批次状态机等纯逻辑；`src/__tests__/` 为组件冒烟测试。
- **后端：** 各模块内 `#[cfg(test)]` 纯函数单测（解析、签名、URL/Cookie 工具、DB repo 等）。真实网络用例以 `#[ignore]` 标记，需环境变量（如 `YDISKS_LIVE_BAIDU_COOKIE`）。

### 项目结构

```
transfer-assistant/
├── src/                     # 前端
│   ├── App.tsx              # 应用外壳：路由 + 模态编排 + 账号 CRUD
│   ├── pages/               # 四个页面组件
│   ├── components/          # 可复用组件（ui / tables / modals / fields）
│   ├── hooks/               # 状态域（主题 / toast / API 连接 / 网盘登录 / 批次引擎）
│   ├── lib/                 # 纯逻辑模块（parsing / engine / batchReducer / bridge …）
│   └── types.ts             # 前端领域类型
├── src-tauri/               # 后端
│   ├── src/
│   │   ├── lib.rs           # 插件装配 + generate_handler!
│   │   ├── commands.rs      # 32 个 #[tauri::command] 包装
│   │   ├── backend/         # Ydisks 后台 API 客户端
│   │   ├── providers/       # 夸克/百度/迅雷 转存与目录列举
│   │   ├── auth/            # 登录窗口编排与 Cookie/token 抓取
│   │   ├── import/          # 分享链接解析
│   │   ├── db/              # SQLite 持久化（含迁移）
│   │   ├── http/            # reqwest 单例 + 工具
│   │   ├── types.rs / config.rs / error.rs / logging.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/workflows/       # CI（见下）
└── package.json
```

---

## 📦 构建发布

### 本地构建

```bash
npm run tauri:build -- --bundles app     # macOS：生成 .app
npm run tauri:build                       # 当前平台默认安装包
```

### CI 自动构建与发版（GitHub Actions）

仓库内置 `.github/workflows/build.yml`，两种模式：

- **push 到 `main`** - 构建三平台并逐个上传原始安装包 artifact（CI 验证 + 取最新版），**不**发 Release。
- **手动 `workflow_dispatch`** - 注入版本号构建，完成后自动打 tag + 发 GitHub Release，安装包（`.dmg` / `.msi` / `.exe`）作为 Release 资产上传。在仓库 **Actions -> build -> Run workflow** 手动触发。

**矩阵** - macOS Apple Silicon（`aarch64`）、macOS Intel（`x86_64`）、Windows（`x86_64`）三份并行。

> Windows job 会从 GitHub Secrets 导入自签名证书并签署 `.msi/.exe`，但由于证书不是公共信任证书，SmartScreen 仍可能需要点击「更多信息 -> 仍要运行」。macOS job 使用不依赖 Apple 证书的 ad-hoc 签名，不能替代 Developer ID 和公证；CI 还会通过 `hdiutil` 把双击修复脚本 `macos-unblock.command` 注入到 DMG 根目录（Tauri 无内置配置支持注入 DMG 额外文件，见 `scripts/inject_dmg_extra.sh`）。

### 版本管理

版本号由 git 历史自动推导（`scripts/version.mjs`），无需手动维护 patch：

- **格式** - `MAJOR.MINOR.PATCH`，初始版本 `v1.0.0`。
- **PATCH 自增** - PATCH = 自最近的基线 tag 以来的提交数。每次提交自动 +1。
  - 例：基线 tag `v1.0.0` 之后第 3 次提交 -> 版本 `1.0.3`。
- **MINOR / MAJOR 升级** - 在目标 commit 上打一个新基线 tag（如 `v1.1.0`、`v2.0.0`），PATCH 自动归零重算。
  - 例：打 `v1.1.0` 后第 1 次提交 -> `1.1.1`（不再延续 1.0.x）。
- **发版流程** - 平时 push 不发版；想发版时在 Actions 手动触发 `workflow_dispatch`，CI 按当前提交推导版本、构建、打 tag `v{版本}` 并发 Release。
- **首次发版** - 仓库尚无任何 `v*` tag 时，第一次手动发版即为 `v1.0.0`，并创建该基线 tag。

仓库内的版本文件（`package.json` / `tauri.conf.json` / `Cargo.toml`）始终保留**基线版本**（如 `1.0.0`）；带 PATCH 的完整版本号只在发版构建时由 CI 临时注入，不回写仓库，保持提交历史干净。

**升级 minor/major 示例：**

```bash
# 在目标 commit 上打新基线 tag 并推送（patch 从此归零重算）
git tag v1.1.0
git push Ydisks-drive-assistant v1.1.0
# 之后在 Actions 手动触发一次发版 -> 发布 v1.1.0，后续提交自动 1.1.1、1.1.2 …
```

---

## 🏗 架构概览

### 前端

- **`App.tsx`** — 薄外壳：页面路由 + 模态编排 + 网盘账号 CRUD。状态机逻辑下沉到 hooks，纯逻辑在 `src/lib/`。
- **`src/lib/`** — 纯模块（带单测）：`parsing`（链接解析）、`engine`（本地批次引擎）、`batchReducer`（批次状态机纯转移）、`bridge`（唯一接触 `@tauri-apps/api` 的模块，封装 `invoke`）、`mappers` / `guards` / `csv` / `format` / `storage`。
- **`src/hooks/`** — UI 状态域：`useApiConnection`（脱敏连接状态 / 额度 / 后台资产）、`useBatchEngine`（1.6s 轮询驱动批次展示与命令编排）、`useXunleiLogin`（迅雷登录交互）、`useCookieModal` / `useToast` / `useThemeMode`。转存限流和敏感配置均由 Rust 最终执行与保存。
- Rust 调用全部经 `src/lib/bridge.ts` 的类型化包装，每个调用由 `isTauriRuntime()` 守卫、错误经 `formatBackendError()` 归一化。

### 后端

`lib.rs` 只装配插件与 `generate_handler!`，32 个 `#[tauri::command]` 在 `commands.rs` 中作薄包装，业务逻辑分布：

| 模块 | 职责 |
|------|------|
| `backend/` | Ydisks 后台 API 客户端（资产 / 额度 / 原始链接 / 短链） |
| `providers/` | 夸克 / 百度 / 迅雷 转存与目录列举（迅雷含纯哈希 / 签名工具） |
| `auth/` | 登录窗口编排与 Cookie / token 抓取 |
| `import/parser.rs` | 分享链接解析、访问码提取、去重、额度测算 |
| `db/` | SQLite 持久化（账号 / 批次 / 历史，版本化迁移） |
| `runtime_config.rs` | 后端运行配置文件的生成、校验、原子保存与内存重载 |
| `http/client.rs` | reqwest 单例 + JSON / URL / cookie 工具 |

### 关键机制

- **批次状态机** — 1.6s 轮询推进队列项状态，决策（「该处理哪一项」「批次是否完成」）为 `batchReducer.ts` 中的纯谓词（带单测）。
- **平台级串行化** — 同一网盘（`quark`/`baidu`/`xunlei`）同时只允许一个 `running` 批次，其余排队。
- **转存限流** — Rust 按平台共享限流状态，读取后端 `config.json` 中的间隔（默认 4 秒、最低 3 秒）；设置页修改后由 Rust 原子写盘并重新载入，前端不能绕过最低值。
- **额度同步** — 每次 `createBackendLinks` 成功后 `deductQuotaLocally(count)` 本地乐观扣减；批次全部完成移入历史时 `syncQuotaFromBackend()` 一次校正漂移。

---

## ⚖️ 许可证

本项目基于 [**Apache License 2.0**](./LICENSE) 开源。

```
Copyright 2025 Ydisks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

> **注意：** 「Ydisks」名称及 [Ydisks 统计平台](https://www.ydisks.com) 的后台 API、控制台等服务由 Ydisks 提供，本项目不主张其所有权。Apache 2.0 许可证仅覆盖本仓库内的源代码，不授予任何 Ydisks 商标或服务的使用权。

---

## 🙏 致谢

- [Tauri](https://tauri.app/) — 跨平台桌面应用框架
- [React](https://react.dev/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/)
- [Tokio](https://tokio.rs/) · [reqwest](https://docs.rs/reqwest/) · [rusqlite](https://docs.rs/rusqlite/)
- [Ydisks 统计平台](https://www.ydisks.com) — 短链与统计服务
