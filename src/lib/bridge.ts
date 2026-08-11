//! Tauri 桥接层：把对 Rust 命令的 `invoke` 调用集中封装为带类型的异步函数。
//!
//! 所有桥接函数在调用前统一判断 `isTauriRuntime()`，浏览器开发环境给出明确提示；
//! Rust 侧错误经 `formatBackendError` 归一化为前端可读消息。本模块为纯函数集合，
//! 不依赖 React，可被任意组件 / hook 引用。
//!
//! 分组：
//! - 转存与目录：`transferProviderShare` / `listProviderFolders`
//! - 登录捕获：`openProviderLogin` / `startXunleiLogin` / `checkXunleiLogin` /
//!   `openXunleiReviewWindow` / `loginXunleiPassword` / `captureProviderLogin` / `checkProviderLogin`
//! - 持久化（SQLite）：账号 / 批次 / 历史的增删查
//! - 导入解析：`parseImport`
//! - 后台 API：`createBackendLinks` / `loadBackendAssets` / `loadBackendQuota`
//! - 导出与工具：`downloadHistoryCsv` / `waitForNextPaint` / `isTauriRuntime`

import { invoke } from '@tauri-apps/api/core';

import { buildHistoryCsv } from './csv';
import { formatBackendError } from './format';
import {
  accountFromRow,
  accountToRow,
  batchFromRow,
  batchToRow,
  historyFromRow,
  historyToRow,
} from './mappers';
import { providerLabels } from './constants';
import type { ProviderAccount, ProviderKey, QueueItem, ShortLinkTarget } from '../types';
import type {
  BatchRecord,
  HistoryRecord,
  RustAccountRow,
  RustBackendAssetsSnapshot,
  RustBackendCreationResult,
  RustBackendQuotaSummary,
  RustBusinessSettings,
  RustBatchRow,
  RustHistoryRow,
  RustImportParseResult,
  RustProviderFolderItem,
  RustQuarkLoginResult,
  RustQuarkTransferResult,
  RustXunleiLoginCheckResult,
  RustXunleiLoginQrResult,
} from './types';

// 重新导出运行时判定，供组件 / hook 复用，避免各处自行实现。
// （formatBackendError 仍由 ./format 直接导出，App 与组件按需从该处引入。）

/**
 * 判断当前是否运行在 Tauri 桌面运行时内。
 *
 * 依据 `window.__TAURI_INTERNALS__` 是否存在（Tauri v2 注入标志）。
 * 浏览器开发环境返回 `false`，桥接函数据此给出「请在桌面端运行」提示。
 */
export const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * 等待下一帧绘制完成，用于在状态更新后让 DOM 先反映再触发后续操作（如滚动/聚焦）。
 */
export const waitForNextPaint = (): Promise<void> =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

// === 转存与目录 ===

/**
 * 调用 `transfer_share_command` 把分享链接转存到目标目录并生成新分享。
 *
 * `provider` 为 `unknown` 时直接拒绝；缺少运行时抛「请在桌面端运行」。
 */
export const transferProviderShare = async ({
  account,
  item,
  targetFolderRef,
}: {
  account?: ProviderAccount;
  item: QueueItem;
  targetFolderRef: string;
}): Promise<RustQuarkTransferResult> => {
  if (item.provider === 'unknown') {
    throw new Error('无法识别网盘平台');
  }
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行后执行转存');
  }

  try {
    return await invoke<RustQuarkTransferResult>('transfer_share_command', {
      accountId: account?.id ?? item.accountId ?? '',
      sourceUrl: item.sourceUrl,
      targetFolderRef,
      title: item.title,
    });
  } catch (error) {
    if (isTauriRuntime()) {
      throw new Error(formatBackendError(error));
    }
    throw new Error('请在桌面端运行后执行转存');
  }
};

/**
 * 调用 `list_provider_folders_command` 列出网盘子目录。
 *
 * 缺少登录态 / 非桌面端均抛错；Rust 错误经 `formatBackendError` 归一化。
 */
export const listProviderFolders = async ({
  account,
  folderRef,
  provider,
}: {
  account?: ProviderAccount;
  folderRef: string;
  provider: ProviderKey;
}): Promise<RustProviderFolderItem[]> => {
  if (!account?.hasCredential) {
    throw new Error(`${providerLabels[provider]}账号缺少登录态，请重新登录`);
  }
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行后读取目录');
  }
  try {
    return await invoke<RustProviderFolderItem[]>('list_provider_folders_command', {
      accountId: account.id,
      folderRef,
    });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

// === 登录捕获 ===

/** 打开网盘登录窗口（夸克 / 百度），非桌面端静默返回。 */
export const openProviderLogin = async (account: ProviderAccount): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke('open_provider_login_window_command', {
    provider: account.provider,
    accountId: account.id,
  });
};

/** 启动迅雷设备码登录，返回授权二维码信息。 */
export const startXunleiLogin = async (
  account: ProviderAccount,
): Promise<RustXunleiLoginQrResult> => {
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行后获取迅雷授权二维码');
  }
  return invoke<RustXunleiLoginQrResult>('start_xunlei_login_command', { accountId: account.id });
};

/** 查询迅雷设备码登录轮询状态。 */
export const checkXunleiLogin = async (
  account: ProviderAccount,
): Promise<RustXunleiLoginCheckResult> => {
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行后检查迅雷授权状态');
  }
  return invoke<RustXunleiLoginCheckResult>('check_xunlei_login_command', {
    accountId: account.id,
  });
};

/** 打开迅雷风控验证窗口（review 面板）。 */
export const openXunleiReviewWindow = async (url: string): Promise<void> => {
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端打开迅雷验证窗口');
  }
  return invoke<void>('open_xunlei_review_window_command', { url });
};

/** 关闭指定 label 的迅雷二次验证窗口（验证成功后由前端调用）。 */
export const closeXunleiReviewWindow = async (label: string): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>('close_xunlei_review_window_command', { label });
};

/** 用账号密码 + creditKey 登录迅雷，返回登录结果。 */
export const loginXunleiPassword = async (
  account: ProviderAccount,
  username: string,
  password: string,
  creditKey: string,
): Promise<RustQuarkLoginResult> => {
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行后登录迅雷账号');
  }
  return invoke<RustQuarkLoginResult>('login_xunlei_password_command', {
    accountId: account.id,
    username,
    password,
    creditKey,
  });
};

/** 从已打开的登录窗口采集凭证。 */
export const captureProviderLogin = async (
  account: ProviderAccount,
): Promise<RustQuarkLoginResult> => {
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行后获取登录态');
  }
  return invoke<RustQuarkLoginResult>('capture_provider_login_command', {
    provider: account.provider,
    accountId: account.id,
  });
};

/** 校验已有 cookie / token 是否仍有效。 */
export const checkProviderLogin = async (
  account: ProviderAccount,
): Promise<RustQuarkLoginResult> => {
  if (!account.hasCredential) {
    throw new Error(`${providerLabels[account.provider]}账号缺少登录态，请重新登录`);
  }
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行后检测登录态');
  }
  return invoke<RustQuarkLoginResult>('check_provider_login_command', {
    accountId: account.id,
  });
};

/** 手动凭证只在提交瞬间传给 Rust，由 Rust 校验并写入 SQLite。 */
export const saveProviderCredential = async (accountId: string, credential: string): Promise<RustQuarkLoginResult> => {
  if (!isTauriRuntime()) throw new Error('请在桌面端运行后保存登录态');
  try {
    return await invoke<RustQuarkLoginResult>('save_provider_credential_command', { accountId, credential });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

// === 账号 / 批次 / 历史 持久化（SQLite，桌面端） ===

/** 从 SQLite 读取全部网盘账号；浏览器开发环境返回空数组。 */
export const listProviderAccountsFromDb = async (): Promise<ProviderAccount[]> => {
  if (!isTauriRuntime()) {
    return [];
  }
  try {
    const rows = await invoke<RustAccountRow[]>('list_provider_accounts_command');
    return rows.map(accountFromRow);
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** upsert 单个账号到 SQLite。 */
export const upsertProviderAccountToDb = async (account: ProviderAccount): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke('upsert_provider_account_command', { account: accountToRow(account) });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** 删除指定账号。 */
export const deleteProviderAccountFromDb = async (id: string): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke('delete_provider_account_command', { id });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

export const clearProviderCredentialInDb = async (id: string): Promise<void> => {
  if (!isTauriRuntime()) return;
  try { await invoke('clear_provider_credential_command', { id }); }
  catch (error) { throw new Error(formatBackendError(error)); }
};

export const loadBusinessSettings = async (): Promise<RustBusinessSettings> => {
  if (!isTauriRuntime()) return { transferIntervals: { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: false };
  try { return await invoke<RustBusinessSettings>('get_business_settings_command'); }
  catch (error) { throw new Error(formatBackendError(error)); }
};

export const saveTransferIntervals = async (intervals: RustBusinessSettings['transferIntervals']) => {
  if (!isTauriRuntime()) return intervals;
  try { return await invoke<RustBusinessSettings['transferIntervals']>('set_transfer_intervals_command', { intervals }); }
  catch (error) { throw new Error(formatBackendError(error)); }
};

export const configureBackendApiKey = async (apiKey: string): Promise<RustBackendQuotaSummary> => {
  if (!isTauriRuntime()) throw new Error('请在桌面端运行后配置 API Key');
  try { return await invoke<RustBackendQuotaSummary>('configure_backend_api_key_command', { apiKey }); }
  catch (error) { throw new Error(formatBackendError(error)); }
};

export const clearBackendApiKey = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  try { await invoke('clear_backend_api_key_command'); }
  catch (error) { throw new Error(formatBackendError(error)); }
};

export const importLegacyBusinessSettings = async (
  apiKey?: string,
  intervals?: RustBusinessSettings['transferIntervals'],
): Promise<RustBusinessSettings> => {
  if (!isTauriRuntime()) return { transferIntervals: intervals ?? { quark: 4, baidu: 4, xunlei: 4 }, hasApiKey: false };
  try {
    return await invoke<RustBusinessSettings>('import_legacy_business_settings_command', { apiKey, intervals });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** 一次性把旧 localStorage 账号导入 SQLite，返回导入条数。 */
export const importLegacyAccountsToDb = async (accounts: ProviderAccount[]): Promise<number> => {
  if (!isTauriRuntime() || accounts.length === 0) {
    return 0;
  }
  try {
    return await invoke<number>('import_legacy_accounts_command', {
      json: JSON.stringify(accounts.map((account) => ({
        ...accountToRow(account),
        credential: (account as ProviderAccount & { cookie?: string }).cookie,
      }))),
    });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** upsert 单个批次到 SQLite。 */
export const saveBatchToDb = async (batch: BatchRecord): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke('save_batch_command', { batch: batchToRow(batch) });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** 从 SQLite 读取全部批次。 */
export const loadBatchesFromDb = async (): Promise<BatchRecord[]> => {
  if (!isTauriRuntime()) {
    return [];
  }
  try {
    const rows = await invoke<RustBatchRow[]>('load_batches_command');
    return rows.map(batchFromRow);
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** 删除指定批次。 */
export const deleteBatchFromDb = async (id: string): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke('delete_batch_command', { id });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** upsert 单条历史到 SQLite。 */
export const saveHistoryToDb = async (history: HistoryRecord): Promise<void> => {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke('save_history_command', { history: historyToRow(history) });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** Atomically persist a history record and remove its active batch. */
export const archiveBatchInDb = async (batchId: string, history: HistoryRecord): Promise<void> => {
  if (!isTauriRuntime()) return;
  try {
    await invoke('archive_batch_command', { batchId, history: historyToRow(history) });
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

/** 从 SQLite 读取全部历史。 */
export const loadHistoryFromDb = async (): Promise<HistoryRecord[]> => {
  if (!isTauriRuntime()) {
    return [];
  }
  try {
    const rows = await invoke<RustHistoryRow[]>('load_history_command');
    return rows.map(historyFromRow);
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

// === 导入解析 ===

/**
 * 调用 Rust 解析导入文本 / CSV，返回前端归一化后的 `accepted` / `filtered`。
 *
 * `mode` 为 `'csv'` 走 `parse_import_csv_command`，否则走 `parse_import_text_command`。
 */
export const parseImport = async ({
  accountId,
  dedupeEnabled,
  existingUrls,
  mode,
  provider,
  text,
}: {
  accountId: string;
  dedupeEnabled: boolean;
  existingUrls: string[];
  mode: 'text' | 'csv';
  provider: ProviderKey;
  text: string;
}): Promise<{ accepted: { title: string; sourceUrl: string; provider: ProviderKey | 'unknown' }[]; filtered: number }> => {
  const result = await invoke<RustImportParseResult>(
    mode === 'csv' ? 'parse_import_csv_command' : 'parse_import_text_command',
    {
      provider,
      accountId,
      text,
      existingUrls,
      dedupeEnabled,
    },
  );

  return {
    accepted: result.accepted.map((item) => ({
      title: item.title,
      sourceUrl: item.source_url,
      provider: item.provider,
    })),
    filtered: result.filtered,
  };
};

// === 后台 API ===

/**
 * 调用 `create_backend_links_command` 注册原始链接并创建短链。
 *
 * `targets` 转换为 Rust 侧期望的 `{ accountId, channelId, channelName, domain }` 结构。
 */
export const createBackendLinks = async ({
  item,
  targets,
  ydisksAccountId,
}: {
  item: QueueItem;
  targets: ShortLinkTarget[];
  ydisksAccountId: string;
}): Promise<RustBackendCreationResult> => {
  try {
    return await invoke<RustBackendCreationResult>('create_backend_links_command', {
      accountId: ydisksAccountId,
      title: item.title,
      shareUrl: item.shareUrl ?? item.sourceUrl,
      targets: targets.map((target) => ({
        accountId: target.ydisksAccountId,
        channelId: target.channelId,
        channelName: target.channelName,
        domain: target.domain,
      })),
    });
  } catch (error) {
    if (isTauriRuntime()) {
      throw new Error(formatBackendError(error));
    }
    throw new Error('请在桌面端运行后创建后台链接');
  }
};

export const createBackendOriginalLink = async (item: QueueItem, accountId: string): Promise<string> => {
  try {
    return await invoke<string>('create_original_link_command', { accountId, title: item.title, shareUrl: item.shareUrl ?? item.sourceUrl });
  } catch (error) { throw new Error(formatBackendError(error)); }
};

export const createBackendShortLink = async (item: QueueItem, target: ShortLinkTarget) => {
  if (!item.originalLinkId) throw new Error('缺少后台原始链接 ID');
  try {
    return await invoke<{ channelId: string; channelName: string; domain: string; shortUrl: string }>('create_short_link_command', {
      title: item.title, originalLinkId: item.originalLinkId,
      target: { accountId: target.ydisksAccountId, channelId: target.channelId, channelName: target.channelName, domain: target.domain },
    });
  } catch (error) { throw new Error(formatBackendError(error)); }
};

/** 拉取 Ydisks 后台资产（账号 / 渠道 / 域名）。 */
export const loadBackendAssets = async (): Promise<RustBackendAssetsSnapshot> => {
  try {
    return await invoke<RustBackendAssetsSnapshot>('fetch_backend_assets_command');
  } catch (error) {
    if (isTauriRuntime()) {
      throw new Error(formatBackendError(error));
    }
    throw new Error('请在桌面端运行后连接后台');
  }
};

/** 查询短链额度汇总。 */
export const loadBackendQuota = async (): Promise<RustBackendQuotaSummary> => {
  try {
    return await invoke<RustBackendQuotaSummary>('fetch_backend_quota_command');
  } catch (error) {
    if (isTauriRuntime()) {
      throw new Error(formatBackendError(error));
    }
    throw new Error('请在桌面端运行后连接后台');
  }
};

/** 调用 `open_log_dir_command` 在系统文件管理器中打开日志目录，返回日志目录路径。 */
export const openLogDir = async (): Promise<string> => {
  if (!isTauriRuntime()) {
    throw new Error('请在桌面端运行');
  }
  try {
    return await invoke<string>('open_log_dir_command');
  } catch (error) {
    throw new Error(formatBackendError(error));
  }
};

// === 导出与工具 ===

/**
 * 导出历史记录为 CSV。
 *
 * 桌面端走 Rust 命令 `save_text_file_command`：弹出原生「另存为」对话框，
 * 让用户选择保存位置后再写入；返回最终保存路径，用户取消时返回 null。
 * 浏览器开发环境退回 `<a download>`（静默落到下载目录）仅作兜底。
 */
export const downloadHistoryCsv = async (history: HistoryRecord): Promise<string | null> => {
  const content = `﻿${buildHistoryCsv(history)}`;
  const fileName = `Ydisks-转存结果-${history.createdAt.replace(/[^\d]/g, '').slice(0, 12) || 'history'}.csv`;
  if (isTauriRuntime()) {
    try {
      const savedPath = await invoke<string | null>('save_text_file_command', {
        fileName,
        content,
      });
      return savedPath ?? null;
    } catch (error) {
      throw new Error(formatBackendError(error));
    }
  }

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return null;
};
