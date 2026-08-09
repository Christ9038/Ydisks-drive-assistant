import { describe, it, expect } from 'vitest';
import {
  createProviderAccount,
  buildImportItem,
  formatNow,
  createBatchLog,
  generateBatchId,
  normalizePlatformQueues,
  createQueueItemsFromDraft,
  advanceQueueItem,
  advanceLocalBatch,
} from '../engine';
import type { BatchDraft, BatchRecord } from '../types';
import type { ImportItem, QueueItem, ShortLinkTarget } from '../../types';

describe('工厂函数（结构断言）', () => {
  it('createProviderAccount 生成未登录账号', () => {
    const acc = createProviderAccount('quark', '主');
    expect(acc.provider).toBe('quark');
    expect(acc.platformName).toBe('夸克网盘');
    expect(acc.status).toBe('expired');
    expect(acc.id).toContain('quark-');
  });
  it('buildImportItem 复制资源字段并标记 valid', () => {
    const item = buildImportItem({ title: '课程', sourceUrl: 'https://pan.quark.cn/s/a', provider: 'quark' }, 'acc-1', 0);
    expect(item.title).toBe('课程');
    expect(item.accountId).toBe('acc-1');
    expect(item.valid).toBe(true);
    expect(item.id).toContain('I-');
  });
  it('formatNow 形如 YYYY-MM-DD HH:mm', () => {
    expect(formatNow()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it('createBatchLog 生成日志条目', () => {
    const log = createBatchLog('info', '开始');
    expect(log.tone).toBe('info');
    expect(log.message).toBe('开始');
    expect(log.id).toContain('L-');
  });
  it('generateBatchId 形如 B-YYYYMMDD-HHMMSS', () => {
    expect(generateBatchId()).toMatch(/^B-\d{8}-\d{6}$/);
  });
});

describe('advanceQueueItem', () => {
  const targets: ShortLinkTarget[] = [];
  const base: QueueItem = {
    id: 'I-1', provider: 'quark', sourceUrl: 'u', title: 't', valid: true,
    status: 'pending', step: '', progress: 0,
  };
  it('pending → transferring', () => {
    const next = advanceQueueItem({ ...base, status: 'pending' }, 0, targets);
    expect(next.status).toBe('transferring');
    expect(next.progress).toBe(20);
  });
  it('transferring → sharing', () => {
    const next = advanceQueueItem({ ...base, status: 'transferring' }, 0, targets);
    expect(next.status).toBe('sharing');
    expect(next.progress).toBe(45);
  });
  it('sharing 仅更新 step', () => {
    const next = advanceQueueItem({ ...base, status: 'sharing' }, 0, targets);
    expect(next.status).toBe('sharing');
    expect(next.step).toContain('等待我的网盘链接');
  });
  it('creating_shortlink step 含渠道数', () => {
    const next = advanceQueueItem({ ...base, status: 'creating_shortlink' }, 0, [
      { id: 'a', channelId: 'a', channelName: 'A', domain: 'd', ydisksAccountId: 'y', ydisksAccountName: 'Y', enabled: true },
      { id: 'b', channelId: 'b', channelName: 'B', domain: 'd', ydisksAccountId: 'y', ydisksAccountName: 'Y', enabled: true },
    ]);
    expect(next.step).toContain('2 个渠道短链');
  });
  it('done 等终态原样返回', () => {
    const item = { ...base, status: 'done' as const };
    expect(advanceQueueItem(item, 0, targets)).toEqual(item);
  });
});

describe('normalizePlatformQueues', () => {
  const queuedBatch = (id: string, queuePosition = 1): BatchRecord => ({
    id, status: 'queued', provider: 'quark', providerAccountName: 'a',
    ydisksAccountId: 'y', ydisksAccountName: 'Y', targetFolderRef: 'r',
    shortLinkTargetCount: 0, total: 1, completed: 0, currentIndex: 0,
    retrying: 0, waitingQuota: 0, progress: 0, currentStep: '',
    createdAt: '', updatedAt: '', localEngine: true, items: [], logs: [], shortLinkTargets: [],
    queuePosition,
  });

  it('无阻塞批次时提升队首排队批次为 running', () => {
    const result = normalizePlatformQueues([queuedBatch('A', 1), queuedBatch('B', 2)]);
    const a = result.find((b) => b.id === 'A')!;
    const b = result.find((b) => b.id === 'B')!;
    expect(a.status).toBe('running');
    expect(a.queuePosition).toBeUndefined();
    expect(b.status).toBe('queued');
    expect(b.queuePosition).toBe(1);
  });

  it('已有阻塞批次时不提升排队批次', () => {
    const running = { ...queuedBatch('A'), status: 'running' as const, queuePosition: undefined };
    const result = normalizePlatformQueues([running, queuedBatch('B', 1)]);
    expect(result.find((b) => b.id === 'B')!.status).toBe('queued');
  });
});

describe('createQueueItemsFromDraft', () => {
  const resources: ImportItem[] = [
    { id: 'I-0', provider: 'quark', sourceUrl: 'u0', title: 't0', valid: true },
    { id: 'I-1', provider: 'quark', sourceUrl: 'u1', title: 't1', valid: true },
    { id: 'I-2', provider: 'quark', sourceUrl: 'u2', title: 't2', valid: true },
  ];
  const draft: BatchDraft = {
    provider: 'quark', providerAccountId: 'acc-1', providerAccountName: 'a',
    ydisksAccountId: 'y', ydisksAccountName: 'Y', targetFolderRef: 'r',
    shortLinkTargets: [], resources, executable: 2, waitingQuota: 1,
  };

  it('超额项标记 waiting_quota', () => {
    const items = createQueueItemsFromDraft(draft, 'queued');
    expect(items[2].status).toBe('waiting_quota');
    expect(items[0].status).toBe('pending'); // queued 时非 current
  });

  it('running 时首项标记 transferring', () => {
    const items = createQueueItemsFromDraft(draft, 'running');
    expect(items[0].status).toBe('transferring');
    expect(items[0].progress).toBe(12);
    expect(items[1].status).toBe('pending');
  });
});

describe('advanceLocalBatch', () => {
  const baseBatch = (items: QueueItem[], over: Partial<BatchRecord> = {}): BatchRecord => ({
    id: 'B-1', status: 'running', provider: 'quark', providerAccountName: 'a',
    ydisksAccountId: 'y', ydisksAccountName: 'Y', targetFolderRef: 'r',
    shortLinkTargetCount: 0, total: items.length, completed: 0, currentIndex: 0,
    retrying: 0, waitingQuota: 0, progress: 0, currentStep: '',
    createdAt: '', updatedAt: '', localEngine: true, items, logs: [], shortLinkTargets: [],
    ...over,
  });
  const item = (status: QueueItem['status']): QueueItem => ({
    id: 'I-1', provider: 'quark', sourceUrl: 'u', title: 't', valid: true,
    status, step: '', progress: 0,
  });

  it('推进活跃项 transferring → sharing', () => {
    const next = advanceLocalBatch(baseBatch([item('transferring')]));
    expect(next.items[0].status).toBe('sharing');
  });

  it('无活跃项且有 waiting_quota → 批次状态 waiting_quota', () => {
    const next = advanceLocalBatch(baseBatch([item('done'), item('waiting_quota')]));
    expect(next.status).toBe('waiting_quota');
    expect(next.waitingQuota).toBe(1);
  });

  it('无活跃项且有 manual_required → 批次状态 manual_required', () => {
    const next = advanceLocalBatch(baseBatch([item('manual_required')]));
    expect(next.status).toBe('manual_required');
  });

  it('非运行批次原样返回', () => {
    const b = baseBatch([item('pending')], { status: 'paused' });
    expect(advanceLocalBatch(b)).toBe(b);
  });

  it('全部 done（无活跃项）时原样返回批次', () => {
    const b = baseBatch([item('done'), item('done')]);
    const next = advanceLocalBatch(b);
    expect(next).toBe(b);
  });

  it('推进活跃项后更新 completed 计数与 currentStep', () => {
    // 一个 transferring 活跃项 + 一个已完成项；推进 transferring → sharing（仍活跃）
    const next = advanceLocalBatch(baseBatch([item('done'), item('transferring')]));
    expect(next.items[1].status).toBe('sharing');
    expect(next.completed).toBe(1);
    expect(next.currentStep).toContain('串行处理');
  });
});
