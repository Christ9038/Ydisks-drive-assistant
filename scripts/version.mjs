#!/usr/bin/env node
/**
 * 版本推导：基于 git 历史的「自最近基线 tag 以来的提交数」计算 patch。
 *
 * 规则：
 *   - 取最近的 `vMAJOR.MINOR.PATCH` 基线 tag（如 v1.0.0、v1.1.0）。
 *   - 版本 = `MAJOR.MINOR.(PATCH + 自该 tag 以来的提交数)`。
 *       例：v1.0.0 之后 3 次提交 -> 1.0.3；v1.1.0 之后 1 次提交 -> 1.1.1。
 *   - 新打一个 v1.1.0 / v2.0.0 tag 即开始新的 minor/major 线，patch 自动归零重算。
 *   - 仓库还没有任何 v* tag 时（首次发版），回退到 package.json 的 version（基线 1.0.0）。
 *
 * 用法：
 *   node scripts/version.mjs            仅推导并打印，写入 $GITHUB_OUTPUT（CI 用）
 *   node scripts/version.mjs --write    额外把版本写回 package.json / tauri.conf.json / Cargo.toml
 *
 * 仓库内三个版本文件始终保留「基线版本」（如 1.0.0）；带 patch 的完整版本号
 * （如 1.0.3）只在发版构建时由本脚本临时注入，不提交回仓库，保持提交历史干净。
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** 运行 shell 命令，失败（如无 tag）返回空串。 */
function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** 读取 package.json 的 version 作为无 tag 时的回退基线。 */
function fileBaseVersion() {
  return JSON.parse(readFileSync('package.json', 'utf8')).version;
}

/** 推导完整版本号。 */
function computeVersion() {
  const tag = sh("git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*'");
  if (!tag) return fileBaseVersion();
  const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return fileBaseVersion();
  const ahead = Number(sh(`git rev-list --count ${tag}..HEAD`) || '0');
  return `${m[1]}.${m[2]}.${Number(m[3]) + ahead}`;
}

/** 把版本写入一个 JSON 文件（保留 2 空格缩进 + 末尾换行）。 */
function writeJson(file, version) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.version = version;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** 把推导版本写回三个版本文件（仅 CI 构建时调用）。 */
function writeVersion(version) {
  writeJson('package.json', version);
  writeJson('src-tauri/tauri.conf.json', version);
  let cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
  cargo = cargo.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
  writeFileSync('src-tauri/Cargo.toml', cargo);
}

const version = computeVersion();
if (process.argv.includes('--write')) writeVersion(version);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(version);
