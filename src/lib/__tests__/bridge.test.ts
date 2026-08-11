import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 桩接 Tauri 核心 invoke；bridge 所有桥接函数最终都走这里。
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import {
  isTauriRuntime,
  waitForNextPaint,
  transferProviderShare,
  listProviderFolders,
  openProviderLogin,
  startXunleiLogin,
  checkXunleiLogin,
  openXunleiReviewWindow,
  closeXunleiReviewWindow,
  loginXunleiPassword,
  captureProviderLogin,
  checkProviderLogin,
  saveProviderCredential,
  listProviderAccountsFromDb,
  upsertProviderAccountToDb,
  deleteProviderAccountFromDb,
  clearProviderCredentialInDb,
  loadBusinessSettings,
  saveTransferIntervals,
  configureBackendApiKey,
  clearBackendApiKey,
  importLegacyBusinessSettings,
  importLegacyAccountsToDb,
  saveBatchToDb,
  loadBatchesFromDb,
  deleteBatchFromDb,
  saveHistoryToDb,
  archiveBatchInDb,
  loadHistoryFromDb,
  parseImport,
  createBackendLinks,
  createBackendOriginalLink,
  createBackendShortLink,
  loadBackendAssets,
  loadBackendQuota,
  openLogDir,
  openConsole,
  downloadHistoryCsv,
} from '../bridge';
import { accountToRow, batchToRow, historyToRow } from '../mappers';
import type { ProviderAccount, QueueItem, ShortLinkTarget } from '../../types';
import type { BatchRecord, HistoryRecord } from '../types';

const account: ProviderAccount = {
  id: 'quark-1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主',
  status: 'connected',
  loginName: 'user',
  purpose: '',
  lastChecked: '-',
  hasCredential: true,
};

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'I-1',
  provider: 'quark',
  sourceUrl: 'https://pan.quark.cn/s/a',
  title: '课程',
  valid: true,
  status: 'sharing',
  step: '',
  progress: 0,
  ...over,
});

const batchRecord: BatchRecord = {
  id: 'B-1',
  status: 'running',
  provider: 'quark',
  providerAccountName: '主',
  ydisksAccountId: 'y-1',
  ydisksAccountName: 'Ydisks',
  targetFolderRef: 'quark:fid:0',
  shortLinkTargetCount: 0,
  total: 1,
  completed: 0,
  currentIndex: 1,
  retrying: 0,
  waitingQuota: 0,
  progress: 0,
  currentStep: '',
  createdAt: '2026-01-01 10:00',
  updatedAt: '',
  localEngine: true,
  items: [],
  logs: [],
  shortLinkTargets: [],
};

const historyRecord: HistoryRecord = {
  id: 'B-1',
  status: 'success',
  createdAt: '2026-01-01 10:00',
  total: 1,
  completed: 1,
  failed: 0,
  items: [],
  logs: [],
};

const targets: ShortLinkTarget[] = [{
  id: 'ch1', channelId: 'ch1', channelName: 'Q群', domain: 'ydisks.com',
  ydisksAccountId: 'y-1', ydisksAccountName: 'Ydisks', enabled: true,
}];

const setRuntime = (on: boolean) => {
  if (on) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
};

beforeEach(() => {
  setRuntime(false);
  vi.clearAllMocks();
});

afterEach(() => {
  setRuntime(false);
});

describe('isTauriRuntime / waitForNextPaint', () => {
  it('无 __TAURI_INTERNALS__ 时返回 false', () => {
    expect(isTauriRuntime()).toBe(false);
  });
  it('有 __TAURI_INTERNALS__ 时返回 true', () => {
    setRuntime(true);
    expect(isTauriRuntime()).toBe(true);
  });
  it('waitForNextPaint 解析完成', async () => {
    await expect(waitForNextPaint()).resolves.toBeUndefined();
  });
});

describe('transferProviderShare', () => {
  it('unknown 平台直接拒绝', async () => {
    setRuntime(true);
    await expect(transferProviderShare({ account, item: item({ provider: 'unknown' }), targetFolderRef: 'r' }))
      .rejects.toThrow('无法识别网盘平台');
  });
  it('非桌面端拒绝', async () => {
    await expect(transferProviderShare({ account, item: item(), targetFolderRef: 'r' }))
      .rejects.toThrow('请在桌面端运行后执行转存');
  });
  it('桌面端只传 accountId，不把 credential 带回前端', async () => {
    setRuntime(true);
    const result = { shareUrl: 'https://pan.quark.cn/s/new', transferred: true };
    vi.mocked(invoke).mockResolvedValueOnce(result);
    await expect(transferProviderShare({ account, item: item(), targetFolderRef: 'r' })).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith('transfer_share_command', {
      accountId: 'quark-1', sourceUrl: 'https://pan.quark.cn/s/a', targetFolderRef: 'r', title: '课程',
    });
  });
  it('account 缺失时 accountId 为空串', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce({ shareUrl: 'u', transferred: true });
    await transferProviderShare({ account: undefined, item: item(), targetFolderRef: 'r' });
    expect(invoke).toHaveBeenCalledWith('transfer_share_command', expect.objectContaining({ accountId: '' }));
  });
  it('桌面端 invoke 抛错时经 formatBackendError 归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'transfer', code: 5, message: '转存失败' });
    await expect(transferProviderShare({ account, item: item(), targetFolderRef: 'r' }))
      .rejects.toThrow('transfer: 转存失败（5）');
  });
  it('invoke 抛错且运行时丢失时回落桌面端提示', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockImplementationOnce(async () => {
      setRuntime(false);
      throw new Error('boom');
    });
    await expect(transferProviderShare({ account, item: item(), targetFolderRef: 'r' }))
      .rejects.toThrow('请在桌面端运行后执行转存');
  });
});

describe('listProviderFolders', () => {
  it('缺少登录态拒绝', async () => {
    setRuntime(true);
    await expect(listProviderFolders({ account: { ...account, hasCredential: false }, folderRef: 'r', provider: 'quark' }))
      .rejects.toThrow('夸克账号缺少登录态，请重新登录');
  });
  it('非桌面端拒绝', async () => {
    await expect(listProviderFolders({ account, folderRef: 'r', provider: 'quark' }))
      .rejects.toThrow('请在桌面端运行后读取目录');
  });
  it('成功返回目录列表', async () => {
    setRuntime(true);
    const folders = [{ ref: 'fid:1', name: '目录1' }];
    vi.mocked(invoke).mockResolvedValueOnce(folders);
    await expect(listProviderFolders({ account, folderRef: 'r', provider: 'quark' })).resolves.toEqual(folders);
    expect(invoke).toHaveBeenCalledWith('list_provider_folders_command', { accountId: 'quark-1', folderRef: 'r' });
  });
  it('invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'folders', message: '失败' });
    await expect(listProviderFolders({ account, folderRef: 'r', provider: 'quark' })).rejects.toThrow('folders: 失败');
  });
});

describe('登录捕获', () => {
  it('openProviderLogin 非桌面端静默返回', async () => {
    await expect(openProviderLogin(account)).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('openProviderLogin 桌面端调用 invoke', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await openProviderLogin(account);
    expect(invoke).toHaveBeenCalledWith('open_provider_login_window_command', { provider: 'quark', accountId: 'quark-1' });
  });
  it('startXunleiLogin 非桌面端拒绝', async () => {
    await expect(startXunleiLogin(account)).rejects.toThrow('请在桌面端运行后获取迅雷授权二维码');
  });
  it('startXunleiLogin 桌面端返回二维码信息', async () => {
    setRuntime(true);
    const qr = { qrUrl: 'https://x', interval: 2, expiresIn: 300, token: 't' };
    vi.mocked(invoke).mockResolvedValueOnce(qr);
    await expect(startXunleiLogin(account)).resolves.toEqual(qr);
    expect(invoke).toHaveBeenCalledWith('start_xunlei_login_command', { accountId: 'quark-1' });
  });
  it('checkXunleiLogin 非桌面端拒绝', async () => {
    await expect(checkXunleiLogin(account)).rejects.toThrow('请在桌面端运行后检查迅雷授权状态');
  });
  it('checkXunleiLogin 桌面端返回轮询状态', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'pending', message: '等待扫码' });
    await checkXunleiLogin(account);
    expect(invoke).toHaveBeenCalledWith('check_xunlei_login_command', { accountId: 'quark-1' });
  });
  it('openXunleiReviewWindow 非桌面端拒绝', async () => {
    await expect(openXunleiReviewWindow('https://x')).rejects.toThrow('请在桌面端打开迅雷验证窗口');
  });
  it('openXunleiReviewWindow 桌面端调用', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await openXunleiReviewWindow('https://x');
    expect(invoke).toHaveBeenCalledWith('open_xunlei_review_window_command', { url: 'https://x' });
  });
  it('closeXunleiReviewWindow 非桌面端静默返回', async () => {
    await expect(closeXunleiReviewWindow('lbl')).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('closeXunleiReviewWindow 桌面端调用', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await closeXunleiReviewWindow('lbl');
    expect(invoke).toHaveBeenCalledWith('close_xunlei_review_window_command', { label: 'lbl' });
  });
  it('loginXunleiPassword 非桌面端拒绝', async () => {
    await expect(loginXunleiPassword(account, 'u', 'p', 'ck')).rejects.toThrow('请在桌面端运行后登录迅雷账号');
  });
  it('loginXunleiPassword 桌面端返回登录结果', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce({ success: true, hasCredential: true });
    await loginXunleiPassword(account, 'u', 'p', 'ck');
    expect(invoke).toHaveBeenCalledWith('login_xunlei_password_command', { accountId: 'quark-1', username: 'u', password: 'p', creditKey: 'ck' });
  });
  it('captureProviderLogin 非桌面端拒绝', async () => {
    await expect(captureProviderLogin(account)).rejects.toThrow('请在桌面端运行后获取登录态');
  });
  it('captureProviderLogin 桌面端返回结果', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce({ success: true, hasCredential: true });
    await captureProviderLogin(account);
    expect(invoke).toHaveBeenCalledWith('capture_provider_login_command', { provider: 'quark', accountId: 'quark-1' });
  });
  it('checkProviderLogin 缺少登录态拒绝', async () => {
    setRuntime(true);
    await expect(checkProviderLogin({ ...account, hasCredential: false })).rejects.toThrow('夸克账号缺少登录态，请重新登录');
  });
  it('checkProviderLogin 非桌面端拒绝', async () => {
    await expect(checkProviderLogin(account)).rejects.toThrow('请在桌面端运行后检测登录态');
  });
  it('checkProviderLogin 桌面端返回结果', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce({ success: true, hasCredential: true });
    await checkProviderLogin(account);
    expect(invoke).toHaveBeenCalledWith('check_provider_login_command', { accountId: 'quark-1' });
  });
});

describe('账号 / 批次 / 历史持久化', () => {
  it('手动凭证只提交给 Rust 并返回脱敏结果', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce({ loginName: 'u', cookieCount: 2, hasCredential: true });
    await expect(saveProviderCredential('q1', 'secret')).resolves.toEqual(expect.objectContaining({ hasCredential: true }));
    expect(invoke).toHaveBeenCalledWith('save_provider_credential_command', { accountId: 'q1', credential: 'secret' });
  });

  it('清理账号凭证调用 Rust', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await clearProviderCredentialInDb('q1');
    expect(invoke).toHaveBeenCalledWith('clear_provider_credential_command', { id: 'q1' });
  });

  it('业务设置全部通过 Rust 读写', async () => {
    setRuntime(true);
    const settings = { transferIntervals: { quark: 4, baidu: 5, xunlei: 6 }, hasApiKey: true };
    vi.mocked(invoke).mockResolvedValueOnce(settings);
    await expect(loadBusinessSettings()).resolves.toEqual(settings);
    expect(invoke).toHaveBeenLastCalledWith('get_business_settings_command');
    vi.mocked(invoke).mockResolvedValueOnce(settings.transferIntervals);
    await saveTransferIntervals(settings.transferIntervals);
    expect(invoke).toHaveBeenLastCalledWith('set_transfer_intervals_command', { intervals: settings.transferIntervals });
  });

  it('API Key 配置/清除及旧配置迁移均调用 Rust', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce({ maxLinks: 1, usedLinks: 0, remainingLinks: 1, shortlinkAccessStatus: 'ACTIVE' });
    await configureBackendApiKey('secret');
    expect(invoke).toHaveBeenLastCalledWith('configure_backend_api_key_command', { apiKey: 'secret' });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await clearBackendApiKey();
    expect(invoke).toHaveBeenLastCalledWith('clear_backend_api_key_command');
    vi.mocked(invoke).mockResolvedValueOnce({ transferIntervals: { quark: 3, baidu: 4, xunlei: 4 }, hasApiKey: true });
    await importLegacyBusinessSettings('old', { quark: 1, baidu: 4, xunlei: 4 });
    expect(invoke).toHaveBeenLastCalledWith('import_legacy_business_settings_command', {
      apiKey: 'old', intervals: { quark: 1, baidu: 4, xunlei: 4 },
    });
  });
  it('listProviderAccountsFromDb 非桌面端返回空', async () => {
    await expect(listProviderAccountsFromDb()).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('listProviderAccountsFromDb 映射行到账号', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce([accountToRow(account)]);
    const result = await listProviderAccountsFromDb();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('quark-1');
    expect(result[0].hasCredential).toBe(true);
  });
  it('listProviderAccountsFromDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: '失败' });
    await expect(listProviderAccountsFromDb()).rejects.toThrow('db: 失败');
  });
  it('upsertProviderAccountToDb 非桌面端静默', async () => {
    await upsertProviderAccountToDb(account);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('upsertProviderAccountToDb 桌面端写入', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await upsertProviderAccountToDb(account);
    expect(invoke).toHaveBeenCalledWith('upsert_provider_account_command', { account: accountToRow(account) });
  });
  it('upsertProviderAccountToDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(upsertProviderAccountToDb(account)).rejects.toThrow('db: x');
  });
  it('deleteProviderAccountFromDb 非桌面端静默', async () => {
    await deleteProviderAccountFromDb('quark-1');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('deleteProviderAccountFromDb 桌面端删除', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await deleteProviderAccountFromDb('quark-1');
    expect(invoke).toHaveBeenCalledWith('delete_provider_account_command', { id: 'quark-1' });
  });
  it('deleteProviderAccountFromDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(deleteProviderAccountFromDb('quark-1')).rejects.toThrow('db: x');
  });
  it('importLegacyAccountsToDb 非桌面端返回 0', async () => {
    await expect(importLegacyAccountsToDb([account])).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('importLegacyAccountsToDb 空账号返回 0', async () => {
    setRuntime(true);
    await expect(importLegacyAccountsToDb([])).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('importLegacyAccountsToDb 成功返回导入条数', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(1);
    await expect(importLegacyAccountsToDb([account])).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith('import_legacy_accounts_command', { json: JSON.stringify([accountToRow(account)]) });
  });
  it('importLegacyAccountsToDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(importLegacyAccountsToDb([account])).rejects.toThrow('db: x');
  });
  it('saveBatchToDb 非桌面端静默', async () => {
    await saveBatchToDb(batchRecord);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('saveBatchToDb 桌面端写入', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await saveBatchToDb(batchRecord);
    expect(invoke).toHaveBeenCalledWith('save_batch_command', { batch: batchToRow(batchRecord) });
  });
  it('saveBatchToDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(saveBatchToDb(batchRecord)).rejects.toThrow('db: x');
  });
  it('loadBatchesFromDb 非桌面端返回空', async () => {
    await expect(loadBatchesFromDb()).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('loadBatchesFromDb 映射行到批次', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce([batchToRow(batchRecord)]);
    const result = await loadBatchesFromDb();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('B-1');
  });
  it('loadBatchesFromDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(loadBatchesFromDb()).rejects.toThrow('db: x');
  });
  it('deleteBatchFromDb 非桌面端静默', async () => {
    await deleteBatchFromDb('B-1');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('deleteBatchFromDb 桌面端删除', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await deleteBatchFromDb('B-1');
    expect(invoke).toHaveBeenCalledWith('delete_batch_command', { id: 'B-1' });
  });
  it('deleteBatchFromDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(deleteBatchFromDb('B-1')).rejects.toThrow('db: x');
  });
  it('saveHistoryToDb 非桌面端静默', async () => {
    await saveHistoryToDb(historyRecord);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('saveHistoryToDb 桌面端写入', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await saveHistoryToDb(historyRecord);
    expect(invoke).toHaveBeenCalledWith('save_history_command', { history: historyToRow(historyRecord) });
  });
  it('saveHistoryToDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(saveHistoryToDb(historyRecord)).rejects.toThrow('db: x');
  });
  it('loadHistoryFromDb 非桌面端返回空', async () => {
    await expect(loadHistoryFromDb()).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('loadHistoryFromDb 映射行到历史', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce([historyToRow(historyRecord)]);
    const result = await loadHistoryFromDb();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('B-1');
  });
  it('loadHistoryFromDb invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: 'x' });
    await expect(loadHistoryFromDb()).rejects.toThrow('db: x');
  });
});

describe('parseImport', () => {
  it('text 模式调用 parse_import_text_command 并映射字段', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      accepted: [{ title: 'a', source_url: 'https://pan.quark.cn/s/a', provider: 'quark' }],
      filtered: 1,
    });
    const result = await parseImport({ accountId: 'acc', dedupeEnabled: true, existingUrls: [], mode: 'text', provider: 'quark', text: 'x' });
    expect(invoke).toHaveBeenCalledWith('parse_import_text_command', expect.objectContaining({ provider: 'quark', accountId: 'acc', text: 'x' }));
    expect(result.accepted[0].sourceUrl).toBe('https://pan.quark.cn/s/a');
    expect(result.filtered).toBe(1);
  });
  it('csv 模式调用 parse_import_csv_command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: [], filtered: 0 });
    await parseImport({ accountId: 'acc', dedupeEnabled: false, existingUrls: ['u'], mode: 'csv', provider: 'baidu', text: 'x' });
    expect(invoke).toHaveBeenCalledWith('parse_import_csv_command', expect.objectContaining({ provider: 'baidu', existingUrls: ['u'], dedupeEnabled: false }));
  });
});

describe('后台 API', () => {
  it('createBackendLinks 成功并转换 targets', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ originalUrl: 'o', shortLinks: [] });
    await createBackendLinks({ item: item({ shareUrl: 'https://pan.quark.cn/s/mine' }), targets, ydisksAccountId: 'y-1' });
    expect(invoke).toHaveBeenCalledWith('create_backend_links_command', expect.objectContaining({
      accountId: 'y-1', title: '课程', shareUrl: 'https://pan.quark.cn/s/mine',
      targets: [{ accountId: 'y-1', channelId: 'ch1', channelName: 'Q群', domain: 'ydisks.com' }],
    }));
  });
  it('createBackendLinks 无 shareUrl 时回落 sourceUrl', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ originalUrl: 'o', shortLinks: [] });
    await createBackendLinks({ item: item(), targets, ydisksAccountId: 'y-1' });
    expect(invoke).toHaveBeenCalledWith('create_backend_links_command', expect.objectContaining({ shareUrl: 'https://pan.quark.cn/s/a' }));
  });
  it('createBackendLinks invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'backend', message: '失败' });
    await expect(createBackendLinks({ item: item(), targets, ydisksAccountId: 'y-1' })).rejects.toThrow('backend: 失败');
  });
  it('createBackendLinks invoke 抛错且运行时丢失时回落桌面端提示', async () => {
    vi.mocked(invoke).mockImplementationOnce(async () => {
      setRuntime(false);
      throw new Error('boom');
    });
    await expect(createBackendLinks({ item: item(), targets, ydisksAccountId: 'y-1' })).rejects.toThrow('请在桌面端运行后创建后台链接');
  });
  it('loadBackendAssets 成功', async () => {
    const snapshot = { quota: { maxLinks: 1, usedLinks: 0, remainingLinks: 1, shortlinkAccessStatus: 'ACTIVE' }, accounts: [], channels: [], domains: [] };
    vi.mocked(invoke).mockResolvedValueOnce(snapshot);
    await expect(loadBackendAssets()).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith('fetch_backend_assets_command');
  });
  it('loadBackendAssets invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'backend', message: 'x' });
    await expect(loadBackendAssets()).rejects.toThrow('backend: x');
  });
  it('loadBackendAssets invoke 抛错且运行时丢失时回落桌面端提示', async () => {
    vi.mocked(invoke).mockImplementationOnce(async () => {
      setRuntime(false);
      throw new Error('boom');
    });
    await expect(loadBackendAssets()).rejects.toThrow('请在桌面端运行后连接后台');
  });
  it('loadBackendQuota 成功', async () => {
    const quota = { maxLinks: 100, usedLinks: 1, remainingLinks: 99, shortlinkAccessStatus: 'ACTIVE' };
    vi.mocked(invoke).mockResolvedValueOnce(quota);
    await expect(loadBackendQuota()).resolves.toEqual(quota);
    expect(invoke).toHaveBeenCalledWith('fetch_backend_quota_command');
  });
  it('loadBackendQuota invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'backend', message: 'x' });
    await expect(loadBackendQuota()).rejects.toThrow('backend: x');
  });
  it('loadBackendQuota invoke 抛错且运行时丢失时回落桌面端提示', async () => {
    vi.mocked(invoke).mockImplementationOnce(async () => {
      setRuntime(false);
      throw new Error('boom');
    });
    await expect(loadBackendQuota()).rejects.toThrow('请在桌面端运行后连接后台');
  });
});

describe('分阶段建链与原子归档桥接', () => {
  const target: ShortLinkTarget = { id: 'c1', channelId: 'c1', channelName: '渠道', domain: 'd.com', ydisksAccountId: 'y1', ydisksAccountName: 'Y', enabled: true };

  it('archiveBatchInDb 桌面端传递完整历史行', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await archiveBatchInDb('B-1', historyRecord);
    expect(invoke).toHaveBeenCalledWith('archive_batch_command', { batchId: 'B-1', history: historyToRow(historyRecord) });
  });
  it('archiveBatchInDb 非桌面端不调用 invoke', async () => {
    await archiveBatchInDb('B-1', historyRecord);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('archiveBatchInDb 归一化错误', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'db', message: '归档失败' });
    await expect(archiveBatchInDb('B-1', historyRecord)).rejects.toThrow('db: 归档失败');
  });
  it('createBackendOriginalLink 使用转存后的 shareUrl', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('orig-1');
    await expect(createBackendOriginalLink(item({ shareUrl: 'https://share' }), 'y1')).resolves.toBe('orig-1');
    expect(invoke).toHaveBeenCalledWith('create_original_link_command', { accountId: 'y1', title: '课程', shareUrl: 'https://share' });
  });
  it('createBackendOriginalLink 归一化错误', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'original_link', message: '失败' });
    await expect(createBackendOriginalLink(item(), 'y1')).rejects.toThrow('original_link: 失败');
  });
  it('createBackendShortLink 精确映射单个目标', async () => {
    const response = { channelId: 'c1', channelName: '渠道', domain: 'd.com', shortUrl: 'https://d.com/a' };
    vi.mocked(invoke).mockResolvedValueOnce(response);
    await expect(createBackendShortLink(item({ originalLinkId: 'orig-1' }), target)).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledWith('create_short_link_command', {
      title: '课程', originalLinkId: 'orig-1',
      target: { accountId: 'y1', channelId: 'c1', channelName: '渠道', domain: 'd.com' },
    });
  });
  it('createBackendShortLink 缺少 originalLinkId 时拒绝且不调用 invoke', async () => {
    await expect(createBackendShortLink(item(), target)).rejects.toThrow('缺少后台原始链接 ID');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('createBackendShortLink 归一化错误', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'short_link', message: '失败' });
    await expect(createBackendShortLink(item({ originalLinkId: 'orig-1' }), target)).rejects.toThrow('short_link: 失败');
  });
});

describe('openLogDir', () => {
  it('非桌面端拒绝', async () => {
    await expect(openLogDir()).rejects.toThrow('请在桌面端运行');
  });
  it('桌面端返回日志目录路径', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce('/logs');
    await expect(openLogDir()).resolves.toBe('/logs');
    expect(invoke).toHaveBeenCalledWith('open_log_dir_command');
  });
  it('invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'log', message: 'x' });
    await expect(openLogDir()).rejects.toThrow('log: x');
  });
});

describe('openConsole', () => {
  it('桌面端调用系统浏览器命令', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await expect(openConsole()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('open_console_command');
  });

  it('浏览器环境打开统计后台新标签页', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await expect(openConsole()).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith('https://console.ydisks.com', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});

describe('downloadHistoryCsv', () => {
  it('桌面端返回保存路径', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce('/path/to/file.csv');
    await expect(downloadHistoryCsv(historyRecord)).resolves.toBe('/path/to/file.csv');
    expect(invoke).toHaveBeenCalledWith('save_text_file_command', expect.objectContaining({ content: expect.stringContaining('﻿') }));
  });
  it('桌面端用户取消时返回 null', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(downloadHistoryCsv(historyRecord)).resolves.toBeNull();
  });
  it('桌面端 invoke 抛错时归一化', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockRejectedValueOnce({ stage: 'save', message: 'x' });
    await expect(downloadHistoryCsv(historyRecord)).rejects.toThrow('save: x');
  });
  it('非桌面端走 <a download> 兜底并返回 null', async () => {
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrl, configurable: true });
    const clickSpy = vi.fn();
    const anchor = { click: clickSpy, href: '', download: '' } as unknown as HTMLAnchorElement;
    const createEl = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    await expect(downloadHistoryCsv(historyRecord)).resolves.toBeNull();
    expect(clickSpy).toHaveBeenCalled();
    createEl.mockRestore();
  });
  it('createdAt 无数字时文件名回落到 history', async () => {
    setRuntime(true);
    vi.mocked(invoke).mockResolvedValueOnce('/path/to/file.csv');
    await downloadHistoryCsv({ ...historyRecord, createdAt: '' });
    expect(invoke).toHaveBeenCalledWith('save_text_file_command', expect.objectContaining({ fileName: 'Ydisks-转存结果-history.csv' }));
  });
});
