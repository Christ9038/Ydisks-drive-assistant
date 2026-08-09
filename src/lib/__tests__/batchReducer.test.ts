import { describe, it, expect } from 'vitest';
import {
  reduceQueueItemUpdate,
  reducePauseBatch,
  reduceContinueBatch,
  reduceRetryBatch,
  reduceRetryQueueItem,
  batchToHistory,
  hasSamePlatformBlocker,
  findItemToTransfer,
  findItemToShortlink,
  isBatchComplete,
  needsBackendRegistration,
} from '../batchReducer';
import type { BatchRecord } from '../types';
import type { QueueItem } from '../../types';

const item = (status: QueueItem['status'], over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'I-1', provider: 'quark', sourceUrl: 'u', title: 't', valid: true,
  status, step: '', progress: 0, ...over,
});

const baseBatch = (items: QueueItem[], over: Partial<BatchRecord> = {}): BatchRecord => ({
  id: 'B-1', status: 'running', provider: 'quark', providerAccountName: 'a',
  ydisksAccountId: 'y', ydisksAccountName: 'Y', targetFolderRef: 'r',
  shortLinkTargetCount: 0, total: items.length, completed: 0, currentIndex: 0,
  retrying: 0, waitingQuota: 0, progress: 0, currentStep: '',
  createdAt: '2026-06-22 10:00', updatedAt: '', localEngine: true, items, logs: [], shortLinkTargets: [],
  ...over,
});

describe('reduceQueueItemUpdate', () => {
  it('标记单项 done 后重算 completed / progress / currentStep', () => {
    const b = baseBatch([item('transferring'), item('pending', { id: 'I-2' })], { total: 2, currentIndex: 1 });
    const next = reduceQueueItemUpdate(b, 'I-1', (it) => ({ ...it, status: 'done', progress: 100 }));
    expect(next.completed).toBe(1);
    expect(next.progress).toBe(50);
    expect(next.currentIndex).toBe(2);
    expect(next.currentStep).toBe('串行处理第 2/2 条');
  });

  it('全部 done 时 currentStep 显示完成', () => {
    const b = baseBatch([item('transferring')], { total: 1 });
    const next = reduceQueueItemUpdate(b, 'I-1', (it) => ({ ...it, status: 'done', progress: 100 }));
    expect(next.completed).toBe(1);
    expect(next.currentStep).toBe('全部资源处理完成');
  });

  it('running 且无活跃项且有 manual_required → 批次状态 manual_required', () => {
    const b = baseBatch([item('manual_required')], { total: 1 });
    const next = reduceQueueItemUpdate(b, 'I-1', (it) => it);
    expect(next.status).toBe('manual_required');
    expect(next.currentStep).toBe('等待人工处理');
  });

  it('running 且无活跃项且有 waiting_retry → 批次状态 waiting_retry', () => {
    const b = baseBatch([item('waiting_retry')], { total: 1 });
    const next = reduceQueueItemUpdate(b, 'I-1', (it) => it);
    expect(next.status).toBe('waiting_retry');
    expect(next.currentStep).toBe('等待重试');
  });

  it('非 running 批次不改变状态', () => {
    const b = baseBatch([item('manual_required')], { total: 1, status: 'paused' });
    const next = reduceQueueItemUpdate(b, 'I-1', (it) => it);
    expect(next.status).toBe('paused');
  });

  it('保留活跃项的进度计入 progress', () => {
    const b = baseBatch([item('transferring', { progress: 40 })], { total: 1, completed: 0 });
    const next = reduceQueueItemUpdate(b, 'I-1', (it) => it);
    expect(next.progress).toBe(40);
  });

  it('不影响其它队列项', () => {
    const other = item('pending', { id: 'I-2' });
    const b = baseBatch([item('pending'), other], { total: 2 });
    const next = reduceQueueItemUpdate(b, 'I-1', (it) => ({ ...it, status: 'transferring' }));
    expect(next.items[1].status).toBe('pending');
  });
});

describe('reducePauseBatch / reduceContinueBatch', () => {
  it('reducePauseBatch 置 paused 并追加日志', () => {
    const next = reducePauseBatch(baseBatch([item('transferring')]));
    expect(next.status).toBe('paused');
    expect(next.currentStep).toBe('用户暂停');
    expect(next.logs[0].message).toBe('用户暂停批次');
  });

  it('reduceContinueBatch 无平台阻塞 → running', () => {
    const next = reduceContinueBatch(baseBatch([item('pending')], { status: 'paused' }), false);
    expect(next.status).toBe('running');
    expect(next.currentStep).toBe('串行处理第 0/1 条');
    expect(next.logs[0].message).toBe('用户继续批次');
  });

  it('reduceContinueBatch 有平台阻塞 → queued', () => {
    const next = reduceContinueBatch(baseBatch([item('pending')], { status: 'paused' }), true);
    expect(next.status).toBe('queued');
    expect(next.logs[0].message).toBe('继续后进入同平台队列');
  });
});

describe('reduceRetryBatch / reduceRetryQueueItem', () => {
  it('reduceRetryBatch 重置 waiting_retry 项为 pending', () => {
    const b = baseBatch([item('waiting_retry'), item('done')], { total: 2, retrying: 1, status: 'waiting_retry' });
    const next = reduceRetryBatch(b);
    expect(next.status).toBe('running');
    expect(next.retrying).toBe(0);
    expect(next.items[0].status).toBe('pending');
    expect(next.items[1].status).toBe('done');
  });

  it('reduceRetryQueueItem 重置单项并递减 retrying', () => {
    const b = baseBatch([item('waiting_retry', { id: 'I-1' })], { total: 1, retrying: 2 });
    const next = reduceRetryQueueItem(b, 'I-1');
    expect(next.retrying).toBe(1);
    expect(next.items[0].status).toBe('pending');
    expect(next.items[0].progress).toBe(0);
  });

  it('reduceRetryQueueItem 的 retrying 不低于 0', () => {
    const b = baseBatch([item('waiting_retry', { id: 'I-1' })], { total: 1, retrying: 0 });
    const next = reduceRetryQueueItem(b, 'I-1');
    expect(next.retrying).toBe(0);
  });

  it('reduceRetryQueueItem 对已转存项（有 shareUrl）跳过转存，回到 creating_original', () => {
    // 已转存但后台登记失败的项不应重新转存，避免网盘里出现重复文件。
    const b = baseBatch([item('waiting_retry', { id: 'I-1', shareUrl: 'https://pan.quark.cn/s/mine' })], { total: 1, retrying: 1 });
    const next = reduceRetryQueueItem(b, 'I-1');
    expect(next.items[0].status).toBe('creating_original');
    expect(next.items[0].shareUrl).toBe('https://pan.quark.cn/s/mine');
  });

  it('reduceRetryBatch 对已转存项跳过转存，未转存项回到 pending', () => {
    const b = baseBatch([
      item('waiting_retry', { id: 'I-1', shareUrl: 'https://pan.quark.cn/s/mine' }),
      item('waiting_retry', { id: 'I-2' }),
      item('done', { id: 'I-3' }),
    ], { total: 3, retrying: 2, status: 'waiting_retry' });
    const next = reduceRetryBatch(b);
    expect(next.items[0].status).toBe('creating_original');
    expect(next.items[1].status).toBe('pending');
    expect(next.items[2].status).toBe('done');
  });
});

describe('needsBackendRegistration', () => {
  it('有 API Key 且有后台账号时需要登记', () => {
    expect(needsBackendRegistration(baseBatch([item('done')]), 'sk-123')).toBe(true);
  });

  it('无 API Key 时不需要登记（仅转存）', () => {
    expect(needsBackendRegistration(baseBatch([item('done')]), '')).toBe(false);
    expect(needsBackendRegistration(baseBatch([item('done')]), '   ')).toBe(false);
  });

  it('批次未绑定后台账号时不需要登记（仅转存）', () => {
    const b = baseBatch([item('done')], { ydisksAccountId: '' });
    expect(needsBackendRegistration(b, 'sk-123')).toBe(false);
  });
});

describe('batchToHistory', () => {
  it('failed 时失败数取 total - completed（至少 1）', () => {
    const b = baseBatch([item('transferring')], { total: 3, completed: 1 });
    const h = batchToHistory(b, 'failed');
    expect(h.status).toBe('failed');
    expect(h.completed).toBe(1);
    expect(h.failed).toBe(2);
    expect(h.logs?.[0].tone).toBe('danger');
  });

  it('success 时完成数记为 total', () => {
    const b = baseBatch([item('done')], { total: 2, completed: 1 });
    const h = batchToHistory(b, 'success');
    expect(h.status).toBe('success');
    expect(h.completed).toBe(2);
    expect(h.failed).toBe(0);
    expect(h.logs?.[0].tone).toBe('success');
  });

  it('failed 且无完成时失败数至少 1', () => {
    const b = baseBatch([item('transferring')], { total: 5, completed: 5 });
    const h = batchToHistory(b, 'failed');
    expect(h.failed).toBe(1);
  });
});

describe('hasSamePlatformBlocker', () => {
  it('同平台其它批次阻塞 → true', () => {
    const all = [
      baseBatch([item('transferring')], { id: 'B-1', provider: 'quark', status: 'running' }),
      baseBatch([item('pending')], { id: 'B-2', provider: 'quark', status: 'running' }),
    ];
    expect(hasSamePlatformBlocker(all, 'B-2', 'quark')).toBe(true);
  });

  it('同平台无其它阻塞 → false', () => {
    const all = [
      baseBatch([item('transferring')], { id: 'B-1', provider: 'quark', status: 'running' }),
      baseBatch([item('pending')], { id: 'B-2', provider: 'baidu', status: 'running' }),
    ];
    expect(hasSamePlatformBlocker(all, 'B-1', 'quark')).toBe(false);
  });

  it('忽略自身', () => {
    const all = [baseBatch([item('transferring')], { id: 'B-1', provider: 'quark', status: 'running' })];
    expect(hasSamePlatformBlocker(all, 'B-1', 'quark')).toBe(false);
  });
});

describe('引擎决策谓词', () => {
  it('findItemToTransfer 命中 sharing 且无 shareUrl 的项', () => {
    const b = baseBatch([
      item('sharing', { id: 'I-1' }),
      item('sharing', { id: 'I-2', shareUrl: 'https://x' }),
      item('transferring', { id: 'I-3' }),
    ]);
    expect(findItemToTransfer(b)?.id).toBe('I-1');
  });

  it('findItemToTransfer 无匹配时返回 undefined', () => {
    const b = baseBatch([item('sharing', { shareUrl: 'https://x' }), item('pending')]);
    expect(findItemToTransfer(b)).toBeUndefined();
  });

  it('findItemToShortlink 命中 creating_original + 有 shareUrl + 无 originalLinkId', () => {
    const b = baseBatch([
      item('creating_original', { id: 'I-1', shareUrl: 'https://x' }),
      item('creating_original', { id: 'I-2', shareUrl: 'https://x', originalLinkId: 'L1' }),
      item('creating_original', { id: 'I-3' }),
    ]);
    expect(findItemToShortlink(b)?.id).toBe('I-1');
  });

  it('findItemToShortlink 无匹配时返回 undefined', () => {
    const b = baseBatch([item('creating_original', { shareUrl: 'https://x', originalLinkId: 'L1' })]);
    expect(findItemToShortlink(b)).toBeUndefined();
  });

  it('isBatchComplete：本地引擎 + 有项 + 全 done → true', () => {
    const b = baseBatch([item('done'), item('done')], { localEngine: true });
    expect(isBatchComplete(b)).toBe(true);
  });

  it('isBatchComplete：有未完成项 → false', () => {
    const b = baseBatch([item('done'), item('transferring')], { localEngine: true });
    expect(isBatchComplete(b)).toBe(false);
  });

  it('isBatchComplete：无队列项 → false（避免空批次误判完成）', () => {
    const b = baseBatch([], { localEngine: true, total: 0 });
    expect(isBatchComplete(b)).toBe(false);
  });

  it('isBatchComplete：非本地引擎 → false', () => {
    const b = baseBatch([item('done')], { localEngine: false });
    expect(isBatchComplete(b)).toBe(false);
  });
});
