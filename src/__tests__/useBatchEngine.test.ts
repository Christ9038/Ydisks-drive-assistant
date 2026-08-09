import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const bridge = vi.hoisted(() => ({
  createBackendLinks: vi.fn(),
  deleteBatchFromDb: vi.fn(),
  isTauriRuntime: vi.fn(() => false),
  loadBatchesFromDb: vi.fn().mockResolvedValue([]),
  loadHistoryFromDb: vi.fn().mockResolvedValue([]),
  saveBatchToDb: vi.fn(),
  saveHistoryToDb: vi.fn(),
  transferProviderShare: vi.fn(),
}));
vi.mock('../lib/bridge', () => bridge);

import { useBatchEngine } from '../hooks/useBatchEngine';
import type { BatchEngineDeps, ConfirmState } from '../hooks/useBatchEngine';
import type { BatchDraft, BatchRecord } from '../lib/types';
import type { ProviderAccount, QueueItem } from '../types';

const account = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'acc-1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主账号',
  status: 'connected',
  loginName: '',
  purpose: '',
  lastChecked: '',
  cookie: 'c',
  ...over,
});

const draft = (over: Partial<BatchDraft> = {}): BatchDraft => ({
  provider: 'quark',
  providerAccountId: 'acc-1',
  providerAccountName: '主账号',
  ydisksAccountId: '',
  ydisksAccountName: '',
  targetFolderRef: 'quark:fid:0',
  shortLinkTargets: [],
  resources: [{ id: 'r1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true }],
  executable: 1,
  waitingQuota: 0,
  ...over,
});

const deps = (over: Partial<BatchEngineDeps> = {}): BatchEngineDeps => ({
  providerAccounts: [account()],
  apiKey: '',
  updateProviderAccount: vi.fn(),
  setToast: vi.fn(),
  requestConfirm: vi.fn(),
  onBatchCreated: vi.fn(),
  deductQuotaLocally: vi.fn(),
  syncQuotaFromBackend: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const renderEngine = (d: BatchEngineDeps) => renderHook(({ deps }) => useBatchEngine(deps), { initialProps: { deps: d } });

const seededBatch = (over: Partial<BatchRecord> = {}, itemOver: Partial<QueueItem> = {}): BatchRecord => ({
  id: 'B-seed',
  status: 'running',
  provider: 'quark',
  providerAccountName: '主账号',
  ydisksAccountId: '',
  ydisksAccountName: '',
  targetFolderRef: 'quark:fid:0',
  shortLinkTargetCount: 0,
  total: 1,
  completed: 0,
  currentIndex: 1,
  queuePosition: undefined,
  retrying: 0,
  waitingQuota: 0,
  progress: 45,
  currentStep: '处理中',
  createdAt: '2026-01-01 00:00',
  updatedAt: '刚刚',
  localEngine: true,
  logs: [],
  shortLinkTargets: [],
  items: [{
    id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true,
    status: 'sharing', step: '创建链接', progress: 45, accountName: '主账号',
    ...itemOver,
  }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  bridge.isTauriRuntime.mockReturnValue(false);
  bridge.loadBatchesFromDb.mockResolvedValue([]);
  bridge.loadHistoryFromDb.mockResolvedValue([]);
  bridge.transferProviderShare.mockResolvedValue({ shareUrl: 'https://my/s', savedFids: [], title: '资源' });
  bridge.createBackendLinks.mockResolvedValue({ originalLinkId: 'L1', shortLinks: [] });
});

describe('useBatchEngine - createBatch', () => {
  it('可执行且无阻塞 -> running，并触发 onBatchCreated', () => {
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.createBatch(draft()));
    expect(result.current.batches[0].status).toBe('running');
    expect(result.current.batches[0].currentIndex).toBe(1);
    expect(d.onBatchCreated).toHaveBeenCalled();
  });

  it('executable=0 -> waiting_quota', () => {
    const { result } = renderEngine(deps());
    act(() => result.current.createBatch(draft({ executable: 0, waitingQuota: 1 })));
    expect(result.current.batches[0].status).toBe('waiting_quota');
    expect(result.current.batches[0].currentStep).toBe('等待短链额度');
  });
});

// 同平台排队相关用例：generateBatchId 精度为秒，同秒创建会撞 ID，故用伪时钟分隔。
describe('useBatchEngine - 同平台排队', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('同平台已有阻塞批次 -> queued', () => {
    const { result } = renderEngine(deps());
    act(() => result.current.createBatch(draft()));
    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    });
    act(() => result.current.createBatch(draft()));
    const running = result.current.batches.filter((b) => b.status === 'running');
    const queued = result.current.batches.filter((b) => b.status === 'queued');
    expect(running).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect(queued[0].queuePosition).toBe(1);
  });

  it('continue 同平台有阻塞 -> queued', () => {
    const { result } = renderEngine(deps());
    act(() => result.current.createBatch(draft()));
    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    });
    act(() => result.current.createBatch(draft()));
    const running = result.current.batches.find((b) => b.status === 'running')!;
    const queued = result.current.batches.find((b) => b.status === 'queued')!;
    expect(running.id).not.toBe(queued.id);
    act(() => result.current.pauseBatch(running.id));
    act(() => result.current.continueBatch(queued.id));
    expect(result.current.batches.find((b) => b.id === queued.id)!.status).toBe('queued');
  });
});

describe('useBatchEngine - 批次操作', () => {
  it('pause / continue 切换状态', () => {
    const { result } = renderEngine(deps());
    act(() => result.current.createBatch(draft()));
    const id = result.current.batches[0].id;
    act(() => result.current.pauseBatch(id));
    expect(result.current.batches[0].status).toBe('paused');
    act(() => result.current.continueBatch(id));
    expect(result.current.batches[0].status).toBe('running');
  });

  it('retryBatch 重试失败批次', () => {
    const { result } = renderEngine(deps());
    act(() => result.current.createBatch(draft()));
    const id = result.current.batches[0].id;
    act(() => result.current.pauseBatch(id));
    act(() => result.current.retryBatch(id));
    expect(result.current.batches.find((b) => b.id === id)).toBeTruthy();
  });

  it('retryQueueItem 重试指定项', () => {
    const { result } = renderEngine(deps());
    act(() => result.current.createBatch(draft()));
    const batch = result.current.batches[0];
    act(() => result.current.retryQueueItem(batch.id, batch.items[0].id));
    expect(result.current.batches[0].items[0]).toBeTruthy();
  });

  it('cancelBatch 未找到 -> 不弹确认', () => {
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.cancelBatch('nope'));
    expect(d.requestConfirm).not.toHaveBeenCalled();
  });

  it('continueBatch 未找到批次 -> 保持不变', () => {
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.createBatch(draft()));
    const before = result.current.batches;
    act(() => result.current.continueBatch('nonexistent-id'));
    expect(result.current.batches).toBe(before);
  });

  it('cancelBatch 找到 -> 请求确认；确认后转入历史并 toast', () => {
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.createBatch(draft()));
    const id = result.current.batches[0].id;
    act(() => result.current.cancelBatch(id));
    expect(d.requestConfirm).toHaveBeenCalled();
    const state = d.requestConfirm.mock.calls[0][0] as ConfirmState;
    expect(state.danger).toBe(true);
    act(() => state.onConfirm());
    expect(result.current.batches).toHaveLength(0);
    expect(result.current.histories.length).toBeGreaterThanOrEqual(1);
    expect(d.setToast).toHaveBeenCalledWith({ message: '批次已取消', tone: 'info' });
  });
});

describe('useBatchEngine - 持久化加载', () => {
  it('桌面端启动从 SQLite 恢复批次与历史', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch({ status: 'paused', items: [{ id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true, status: 'done', step: '完成', progress: 100, accountName: '主账号' }] })]);
    bridge.loadHistoryFromDb.mockResolvedValue([{ id: 'h1', batchId: 'b0', status: 'success', createdAt: '', total: 1, completed: 1, failed: 0, items: [], logs: [] }]);
    const { result } = renderEngine(deps());
    await waitFor(() => expect(result.current.histories.length).toBeGreaterThanOrEqual(1));
    expect(bridge.loadBatchesFromDb).toHaveBeenCalled();
    expect(bridge.loadHistoryFromDb).toHaveBeenCalled();
  });

  it('加载失败时静默（console.warn）', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockRejectedValue(new Error('db'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderEngine(deps());
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(result.current.batches).toHaveLength(0);
    warn.mockRestore();
  });
});

describe('useBatchEngine - 转存 effect', () => {
  it('仅转存模式（无 API Key）：转存成功直接 done 并转入历史', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch()]);
    const d = deps({ apiKey: '' });
    const { result } = renderEngine(d);
    await waitFor(() => expect(bridge.transferProviderShare).toHaveBeenCalled());
    await waitFor(() => expect(result.current.histories.length).toBeGreaterThanOrEqual(1));
    expect(d.syncQuotaFromBackend).toHaveBeenCalled();
  });

  it('有后台登记：转存成功推进到 creating_original 并创建短链', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch({ ydisksAccountId: 'y1' })]);
    bridge.createBackendLinks.mockResolvedValue({ originalLinkId: 'L1', shortLinks: [{ channelId: 'c1', channelName: 'Q群', domain: 'd.com', shortUrl: 'https://s/1' }] });
    const d = deps({ apiKey: 'k' });
    const { result } = renderEngine(d);
    await waitFor(() => expect(bridge.createBackendLinks).toHaveBeenCalled());
    await waitFor(() => expect(d.deductQuotaLocally).toHaveBeenCalledWith(1));
    await waitFor(() => expect(result.current.histories.length).toBeGreaterThanOrEqual(1));
  });

  it('转存遇到鉴权错误 -> manual_required 并标记账号', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch()]);
    bridge.transferProviderShare.mockRejectedValue({ message: '账号缺少登录态' });
    const d = deps();
    const { result } = renderEngine(d);
    await waitFor(() => expect(bridge.transferProviderShare).toHaveBeenCalled());
    await waitFor(() => expect(result.current.batches[0]?.items[0]?.status).toBe('manual_required'));
    expect(d.updateProviderAccount).toHaveBeenCalledWith('acc-1', expect.any(Function));
    // 触发 updater 函数体（mock 不会自动执行传入的更新函数）。
    const updater = d.updateProviderAccount.mock.calls[0][1] as (acc: any) => any;
    const updated = updater({ id: 'acc-1', status: 'connected', pendingReason: '', lastChecked: '' });
    expect(updated.status).toBe('manual_required');
    expect(updated.pendingReason).toBe('账号缺少登录态');
    expect(updated.lastChecked).toBe('刚刚');
  });

  it('转存非鉴权错误 -> waiting_retry', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch()]);
    bridge.transferProviderShare.mockRejectedValue({ message: '网络错误' });
    const d = deps();
    const { result } = renderEngine(d);
    await waitFor(() => expect(result.current.batches[0]?.items[0]?.status).toBe('waiting_retry'));
    expect(d.updateProviderAccount).not.toHaveBeenCalled();
  });

  it('同平台连续转存触发限流排队', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.transferProviderShare.mockResolvedValue({ shareUrl: 'https://my/s', savedFids: [], title: '资源' });
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch({
      ydisksAccountId: '',
      items: [
        { id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s1', title: '资源1', valid: true, status: 'sharing', step: '创建链接', progress: 45, accountName: '主账号' },
        { id: 'I-2', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s2', title: '资源2', valid: true, status: 'pending', step: '排队等待', progress: 0, accountName: '主账号' },
      ],
    })]);
    const d = deps({ apiKey: '' });
    const { result } = renderEngine(d);
    await waitFor(() => expect(bridge.transferProviderShare).toHaveBeenCalledTimes(1));
    // I-2 经两轮轮询进入 sharing 后，因距上次转存 <4s 被限流排队
    await waitFor(() => expect(result.current.batches[0]?.items.find((i) => i.id === 'I-2')?.step).toBe('转存排队中（限流间隔）'), { timeout: 5000 });
  });

  it('多批次并行转存时 appendBatchLog 仅更新目标批次', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.transferProviderShare.mockReturnValue(new Promise(() => {}));
    bridge.loadBatchesFromDb.mockResolvedValue([
      seededBatch({ id: 'B1', provider: 'quark', items: [{ id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s1', title: '资源1', valid: true, status: 'sharing', step: '创建链接', progress: 45, accountName: '主账号' }] }),
      seededBatch({ id: 'B2', provider: 'baidu', providerAccountName: '百度号', targetFolderRef: 'baidu:fid:0', items: [{ id: 'I-2', provider: 'baidu', accountId: 'acc-2', sourceUrl: 'https://s2', title: '资源2', valid: true, status: 'sharing', step: '创建链接', progress: 45, accountName: '百度号' }] }),
    ]);
    const d = deps({ providerAccounts: [account({ id: 'acc-1', provider: 'quark' }), account({ id: 'acc-2', provider: 'baidu', platformName: '百度网盘' })] });
    const { result } = renderEngine(d);
    await waitFor(() => expect(bridge.transferProviderShare).toHaveBeenCalled());
    expect(result.current.batches.length).toBe(2);
  });
});

describe('useBatchEngine - 短链 effect', () => {
  it('短链创建失败 -> waiting_retry', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch({
      ydisksAccountId: 'y1',
      items: [{ id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true, status: 'creating_original', step: '登记', progress: 65, accountName: '主账号', shareUrl: 'https://my/s' }],
    })]);
    bridge.createBackendLinks.mockRejectedValue({ message: '后台失败' });
    const d = deps({ apiKey: 'k' });
    const { result } = renderEngine(d);
    await waitFor(() => expect(bridge.createBackendLinks).toHaveBeenCalled());
    await waitFor(() => expect(result.current.batches[0]?.items[0]?.status).toBe('waiting_retry'));
  });

  it('后台仅登记原始链接（shortLinks 为空）-> done', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch({
      ydisksAccountId: 'y1',
      items: [{ id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true, status: 'creating_original', step: '登记', progress: 65, accountName: '主账号', shareUrl: 'https://my/s' }],
    })]);
    bridge.createBackendLinks.mockResolvedValue({ originalLinkId: 'L1', shortLinks: [] });
    const d = deps({ apiKey: 'k' });
    const { result } = renderEngine(d);
    await waitFor(() => expect(bridge.createBackendLinks).toHaveBeenCalled());
    await waitFor(() => expect(result.current.histories.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    expect(d.deductQuotaLocally).toHaveBeenCalledWith(0);
  });
});

describe('useBatchEngine - 完成 effect', () => {
  it('全部 done 的批次转入历史并同步额度', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch({
      items: [{ id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true, status: 'done', step: '完成', progress: 100, accountName: '主账号', shareUrl: 'https://my/s' }],
    })]);
    const d = deps();
    const { result } = renderEngine(d);
    await waitFor(() => expect(result.current.histories.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    expect(result.current.batches).toHaveLength(0);
    expect(d.syncQuotaFromBackend).toHaveBeenCalled();
  });
});

describe('useBatchEngine - 轮询推进', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1.6s 轮询推进队列项 transferring -> sharing 并发起转存', async () => {
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.createBatch(draft()));
    // 让转存保持 pending，便于断言轮询推进
    bridge.transferProviderShare.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(bridge.transferProviderShare).toHaveBeenCalled();
  });
});

describe('useBatchEngine - 持久化去抖与失败', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.transferProviderShare.mockReturnValue(new Promise(() => {}));
    bridge.saveBatchToDb.mockResolvedValue(undefined);
    bridge.deleteBatchFromDb.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('批次变更后去抖 2s 写库', async () => {
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.createBatch(draft()));
    // 再次变更批次 -> 覆盖去抖 clearTimeout 旧计时器分支
    act(() => result.current.pauseBatch(result.current.batches[0].id));
    expect(bridge.saveBatchToDb).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(bridge.saveBatchToDb).toHaveBeenCalled();
  });

  it('批次移出运行列表后去抖删除旧批次记录', async () => {
    bridge.saveBatchToDb.mockResolvedValue(undefined);
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.createBatch(draft()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(bridge.saveBatchToDb).toHaveBeenCalled();
    const id = result.current.batches[0].id;
    // 取消批次 -> 转入历史，运行列表不再包含该 id，去抖后触发 deleteBatchFromDb。
    act(() => result.current.cancelBatch(id));
    const state = d.requestConfirm.mock.calls[0][0] as ConfirmState;
    act(() => state.onConfirm());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(bridge.deleteBatchFromDb).toHaveBeenCalledWith(id);
  });

  it('写库失败时静默（console.warn）', async () => {
    bridge.saveBatchToDb.mockRejectedValue(new Error('db'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    const { result } = renderEngine(d);
    act(() => result.current.createBatch(draft()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(warn).toHaveBeenCalledWith('保存批次失败', expect.anything());
    warn.mockRestore();
  });
});

describe('useBatchEngine - 历史持久化失败', () => {
  it('历史写库失败时静默（console.warn）', async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.loadBatchesFromDb.mockResolvedValue([seededBatch({
      items: [{ id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true, status: 'done', step: '完成', progress: 100, accountName: '主账号', shareUrl: 'https://my/s' }],
    })]);
    bridge.saveHistoryToDb.mockRejectedValue(new Error('db'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    const { result } = renderEngine(d);
    await waitFor(() => expect(result.current.histories.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('保存历史失败', expect.anything()), { timeout: 2000 });
    warn.mockRestore();
  });
});

