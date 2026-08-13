# CI 与发版说明

> 面向仓库维护者的运维文档。面向用户的安装/使用说明见 [README](../README.md)。

## 概览

只有一个 workflow：`.github/workflows/build.yml`，通过**触发方式**区分两种模式：

| 触发方式 | 行为 | 产物 |
|---------|------|------|
| push 到 `main` | 只构建三平台，不上传 Release | Action run 内的直接安装包 artifact（90 天过期，可下载验证） |
| 手动 `workflow_dispatch` | 注入版本号构建 + 打 tag + 发 GitHub Release | 永久 Release 资产（`.dmg` / `.msi` / `.exe`） |

矩阵：macOS Apple Silicon（`aarch64-apple-darwin`）、macOS Intel（`x86_64-apple-darwin`）、Windows（`x86_64`），三份并行。Windows 安装包使用仓库维护者生成的自签名代码签名证书；macOS 使用不依赖证书的 ad-hoc 签名。

并发控制：按 `事件类型 + 分支` 分组取消旧 run，push 不会误取消正在跑的发版。

## 日常构建（push 到 main）

无需操作。每次 `git push` 到 `main` 自动触发三平台构建，产物作为 artifact 上传。用于 CI 验证 + 取最新构建。

```bash
git push Ydisks-drive-assistant main
```

构建结果在 **Actions -> 对应 run -> Artifacts** 下载（90 天后过期）。**不会**创建 Release、**不会**打 tag。

## 发版（手动触发）

### 前提

- 代码已推到 `main`（`git push Ydisks-drive-assistant main`）。
- GitHub 仓库 **Settings -> Actions -> General -> Workflow permissions** 允许 `GITHUB_TOKEN` 读写（release job 需要 `contents: write`，已在 workflow 声明）。

### 步骤

1. 仓库 -> **Actions** 标签页
2. 左侧 workflow 列表点 **build**
3. 右上角点 **Run workflow** 下拉
4. 分支保持 `main`，点绿色 **Run workflow**

点了之后自动完成（约 8–15 分钟）：

1. 三平台并行构建，注入推导出的版本号到安装包文件名。
2. macOS 构建后调用 `scripts/inject_dmg_extra.sh`，把 `macos-unblock.command` 注入到每个 DMG 根目录。
3. `release` job（跑在 ubuntu，等三平台都成功）：下载全部 artifact -> 推导版本 -> 打 tag `v{版本}` -> `gh release create` 上传 `.dmg` / `.msi` / `.exe`。

完成后 **Releases** 页可见新版本，带安装包附件，Release notes 由 `--generate-notes` 自动生成（按 commit 标题）。

Actions 的构建产物也会逐个上传为原始文件，不再打成 ZIP：macOS 是两个架构各一个 `.dmg`，Windows 是一个 `.msi` 和一个 `.exe`。GitHub 的直接 artifact 上传一次只能处理一个文件，因此 workflow 使用多个上传步骤；下载 Release 时仍建议使用 Release 页面上的安装包附件。

### 配置 Windows 自签名证书

证书只在本地生成一次，之后将加密的 `.pfx` 内容放入 GitHub Secrets。不要把 `.key`、`.pfx` 或 Base64 文件提交到仓库。

```bash
./scripts/generate_windows_signing_cert.sh
```

脚本默认把文件写入被 `.gitignore` 忽略的 `.local/windows-signing/`，并生成：

- `windows-code-signing.pfx`：供本地备份使用，包含私钥。
- `windows-code-signing.pfx.b64`：复制完整内容到 GitHub Secret `WINDOWS_CERTIFICATE`。
- `windows-code-signing.key` / `windows-code-signing.crt`：本地证书材料。

在仓库 **Settings -> Secrets and variables -> Actions** 中新增：

| Secret | 内容 |
|---|---|
| `WINDOWS_CERTIFICATE` | `windows-code-signing.pfx.b64` 的完整内容 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 生成 PFX 时设置的密码 |

可选地新增 Repository Variable `WINDOWS_TIMESTAMP_URL` 指定 RFC 3161 时间戳服务；未设置时使用 `http://timestamp.digicert.com`。时间戳只能保留签名时间，不能让自签名证书变成公共信任证书。

Windows job 会把 PFX 导入 runner 的当前用户证书库，动态取得带 `Code Signing` EKU 的证书指纹，写入临时 Tauri 配置，并在上传 artifact 前检查每个 `.exe/.msi` 的签名者指纹。

自签名证书只能证明这些安装包来自同一把私钥，默认不会被其他用户的 Windows 信任，因此 SmartScreen 仍可能提示未知发布者。它适合个人、内部分发和测试，不等同于购买的公开代码签名证书。

### macOS ad-hoc 签名

macOS job 使用 `APPLE_SIGNING_IDENTITY: "-"` 进行 ad-hoc 签名，不需要 Apple Developer 账号、OpenSSL 证书或 GitHub Secret。CI 会用 `codesign --verify` 检查 `.app` 的签名。

ad-hoc 签名不是 `Developer ID Application`：不能通过 Apple 公证，也不会让 Gatekeeper 把发布者识别为可信开发者。公开分发仍可能需要用户在「系统设置 -> 隐私与安全性」中允许打开；如果要消除这类提示，仍需 Apple Developer Program、Developer ID 证书和公证。

### 重复发版安全

同一 tag 已存在时 `release` job 会跳过（`gh release view` 检测到即 `exit 0`），不报错、不覆盖。手滑多点一次 Run workflow 无害。

## 版本号规则

版本由 `scripts/version.mjs` 从 git 历史推导，无需手动维护 patch：

- 取最近的 `vMAJOR.MINOR.PATCH` 基线 tag，版本 = `MAJOR.MINOR.(PATCH + 该 tag 之后的提交数)`。
- 无 `v*` tag 时回退 `1.0.0`（首次发版）。

| 场景 | 结果 |
|------|------|
| 首次发版（无 tag） | `1.0.0`，自动创建 `v1.0.0` 基线 tag |
| `v1.0.0` 之后 3 次提交 | `1.0.3` |
| 打 `v1.1.0` 后 1 次提交 | `1.1.1`（patch 归零重算） |
| 打 `v2.0.0` 后 0 次提交 | `2.0.0` |

仓库内版本文件（`package.json` / `tauri.conf.json` / `Cargo.toml`）始终保留基线（如 `1.0.0`）；完整版本号只在 CI 发版构建时临时注入，**不回写仓库**，提交历史保持干净。

### 升级 minor / major（patch 归零）

在目标 commit 上打新基线 tag 并推送：

```bash
git tag v1.1.0
git push Ydisks-drive-assistant v1.1.0
```

之后在 Actions 手动触发一次发版 -> 发布 `v1.1.0`，后续提交自动 `1.1.1`、`1.1.2`…

> 注意：基线 tag 推上去后**不会**自动发版（push tag 不在触发条件里）。仍需手动 Run workflow 发版。

### 本地预览版本号

```bash
node scripts/version.mjs          # 只打印推导版本
node scripts/version.mjs --write  # 额外写回三个版本文件（仅用于本地测试，勿提交）
```

## macOS DMG 注入说明

Tauri v2 没有内置配置把额外文件放进 DMG 根目录（`bundle.macOS.files` / `bundle.resources` 只能塞进 `.app/Contents`）。为让用户打开 DMG 就能看到双击修复脚本，CI 在构建后用 `hdiutil` 注入：

```
Tauri 生成的只读压缩 DMG
  -> hdiutil convert 转读写镜像 (UDRW)
  -> 挂载，拷入 macos-unblock.command（保留执行位）
  -> 卸载，hdiutil convert 转回压缩只读 (UDZO)
  -> 原地覆盖
```

脚本：`scripts/inject_dmg_extra.sh`，CI 调用：
```bash
bash scripts/inject_dmg_extra.sh \
  src-tauri/target/aarch64-apple-darwin/release/bundle/dmg \
  scripts/macos-unblock.command
```

仅 macOS 矩阵运行（`if: matrix.rustTarget != ''`）。注入步骤在 Build 之后、Upload artifact 之前。

## 故障排查

### Windows MSI 构建失败（WiX light.exe）

`productName` 含中文，MSI 默认 `en-US` 代码页 1252 无法编码。已在 `tauri.conf.json` 设 `bundle.windows.wix.language: "zh-CN"`（代码页 936）。若仍失败，确认该配置未被改回。

### release job 报权限错误（无法创建 tag / release）

检查仓库 **Settings -> Actions -> General -> Workflow permissions**：需为 **Read and write permissions**（或至少让 `GITHUB_TOKEN` 有 `contents: write`）。workflow 已声明 `permissions: contents: write`，但仓库级设置可覆盖。

### 发版后 Release 没有资产

`release` job 里 `find` 只收 `.dmg` / `.msi` / `.exe`。若某平台构建失败（`needs: build` 会让 release 不跑），或产物路径变了（Tauri 版本升级改了 bundle 输出路径），会导致资产缺失。检查 build job 的 Upload artifact 步骤实际匹配到的文件。

### 版本号推导异常

`git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*'` 取不到 tag 时回退 `1.0.0`。若误打了不符合 `vX.Y.Z` 格式的 tag（如 `v1`、`v1.0`），会被 `--match` 过滤掉，不影响。确认 tag 格式：
```bash
git tag --list 'v*'
```

### 想重新发同一个版本

当前逻辑：tag 已存在则跳过。如需覆盖（比如安装包有问题要重传），先删 tag 和 release 再发：
```bash
gh release delete v1.0.3 -R Christ9038/Ydisks-drive-assistant --yes
git push Ydisks-drive-assistant :refs/tags/v1.0.3
# 然后手动 Run workflow 重新发版
```

### DMG 注入失败

`inject_dmg_extra.sh` 仅 macOS 可用，非 macOS 自动跳过。若在 macOS runner 上失败，多为 `hdiutil convert` / `detach` 出错（DMG 被占用等），看 build job 的 "Inject unblock script into DMG" 步骤日志。本地可复现：
```bash
# 需先有 Tauri 构建出的 DMG
bash scripts/inject_dmg_extra.sh src-tauri/target/release/bundle/dmg scripts/macos-unblock.command
```

## 文件清单

| 文件 | 作用 |
|------|------|
| `.github/workflows/build.yml` | 唯一 workflow：构建 + 发版 |
| `scripts/version.mjs` | 版本推导（git 历史算法） |
| `scripts/inject_dmg_extra.sh` | macOS DMG 注入额外文件 |
| `scripts/macos-unblock.command` | macOS 免证书双击修复脚本（注入到 DMG） |
| `src-tauri/tauri.conf.json` | `bundle.windows.wix.language: zh-CN` 修复中文 MSI |
