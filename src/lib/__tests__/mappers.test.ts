import { describe, it, expect } from 'vitest';
import {
  safeParseJsonArray,
  accountToRow,
  accountFromRow,
  batchToRow,
  batchFromRow,
  historyToRow,
  historyFromRow,
  buildTargetsFromBackendAssets,
} from '../mappers';
import type { BatchRecord, HistoryRecord, RustBackendAssetsSnapshot } from '../types';
import type { ProviderAccount, QueueItem, ShortLinkTarget } from '../../types';

const account: ProviderAccount = {
  id: 'quark-1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主账号',
  status: 'connected',
  loginName: 'user',
  purpose: '转存',
  lastChecked: '2026-01-01',
  pendingReason: undefined,
  cookie: 'cookie-val',
};

describe('safeParseJsonArray', () => {
  it('合法数组返回', () => {
    expect(safeParseJsonArray<number>('[1,2,3]')).toEqual([1, 2, 3]);
  });
  it('非数组返回空', () => {
    expect(safeParseJsonArray('{"a":1}')).toEqual([]);
  });
  it('非法 JSON 返回空', () => {
    expect(safeParseJsonArray('not json')).toEqual([]);
  });
});

describe('accountToRow / accountFromRow 往返', () => {
  it('cookie 映射为 credential 且可还原', () => {
    const row = accountToRow(account);
    expect(row.credential).toBe('cookie-val');
    expect(row.displayName).toBe('主账号');
    const back = accountFromRow(row);
    expect(back.cookie).toBe('cookie-val');
    expect(back.provider).toBe('quark');
    expect(back.platformName).toBe('夸克网盘');
  });
});

const queueItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'I-1',
  provider: 'quark',
  sourceUrl: 'https://pan.quark.cn/s/a',
  title: '课程',
  valid: true,
  status: 'done',
  step: '完成',
  progress: 100,
  ...over,
});

const batch = (over: Partial<BatchRecord> = {}): BatchRecord => ({
  id: 'B-1',
  status: 'running',
  provider: 'quark',
  providerAccountName: '主账号',
  ydisksAccountId: 'y-1',
  ydisksAccountName: 'Ydisks',
  targetFolderRef: 'quark:fid:0',
  shortLinkTargetCount: 2,
  total: 1,
  completed: 1,
  currentIndex: 1,
  retrying: 0,
  waitingQuota: 0,
  progress: 100,
  currentStep: '完成',
  createdAt: '2026-01-01 10:00',
  updatedAt: '刚刚',
  localEngine: true,
  items: [queueItem()],
  logs: [],
  shortLinkTargets: [],
  ...over,
});

describe('batchToRow / batchFromRow 往返', () => {
  it('items/logs/shortLinkTargets 序列化与反序列化', () => {
    const targets: ShortLinkTarget[] = [{
      id: 'ch1', channelId: 'ch1', channelName: 'Q群', domain: 'ydisks.com',
      ydisksAccountId: 'y-1', ydisksAccountName: 'Ydisks', enabled: true,
    }];
    const row = batchToRow(batch({ shortLinkTargets: targets }));
    expect(row.itemsJson).toContain('课程');
    expect(row.shortLinkTargetsJson).toContain('Q群');
    const back = batchFromRow(row);
    expect(back.items).toHaveLength(1);
    expect(back.shortLinkTargets).toHaveLength(1);
    expect(back.shortLinkTargets[0].channelName).toBe('Q群');
    expect(back.localEngine).toBe(true);
  });
  it('queuePosition undefined → null → undefined', () => {
    const row = batchToRow(batch({ status: 'queued', queuePosition: 2 }));
    expect(row.queuePosition).toBe(2);
    const back = batchFromRow(row);
    expect(back.queuePosition).toBe(2);
  });
});

describe('historyToRow / historyFromRow 往返', () => {
  it('items/logs 序列化与反序列化', () => {
    const history: HistoryRecord = {
      id: 'B-1',
      status: 'success',
      createdAt: '2026-01-01 10:00',
      total: 1,
      completed: 1,
      failed: 0,
      items: [queueItem()],
      logs: [],
    };
    const row = historyToRow(history);
    expect(row.batchId).toBe('B-1');
    expect(row.itemsJson).toContain('课程');
    const back = historyFromRow(row);
    expect(back.items).toHaveLength(1);
    expect(back.status).toBe('success');
  });

  it('items/logs 为 undefined 时序列化为空数组', () => {
    const row = historyToRow({
      id: 'B-1', status: 'success', createdAt: 'x',
      total: 0, completed: 0, failed: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: undefined as any,
      logs: undefined as any,
    });
    expect(row.itemsJson).toBe('[]');
    expect(row.logsJson).toBe('[]');
  });
});

describe('buildTargetsFromBackendAssets', () => {
  const assets: RustBackendAssetsSnapshot = {
    quota: { maxLinks: 100, usedLinks: 0, remainingLinks: 100, shortlinkAccessStatus: 'ACTIVE' },
    accounts: [{ id: 'y-1', name: 'Ydisks' }],
    channels: [
      { id: 'ch1', name: 'Q群' },
      { id: 'ch2', name: 'TG' },
    ],
    domains: [
      { domainName: 'ydisks.com', status: 'ACTIVE' },
      { domainName: 'old.com', status: 'INACTIVE' },
    ],
  };

  it('每个渠道生成一个目标，默认取首个 ACTIVE 域名', () => {
    const targets = buildTargetsFromBackendAssets(assets, []);
    expect(targets).toHaveLength(2);
    expect(targets[0].channelName).toBe('Q群');
    expect(targets[0].domain).toBe('ydisks.com');
    expect(targets[0].ydisksAccountId).toBe('y-1');
    expect(targets[0].enabled).toBe(true);
  });

  it('复用已有目标的可用域名', () => {
    const fallback: ShortLinkTarget[] = [{
      id: 'ch1', channelId: 'ch1', channelName: 'Q群', domain: 'ydisks.com',
      ydisksAccountId: 'y-1', ydisksAccountName: 'Ydisks', enabled: false,
    }];
    const targets = buildTargetsFromBackendAssets(assets, fallback);
    expect(targets[0].enabled).toBe(false);
  });

  it('渠道/账号/域名缺失时回退 fallback', () => {
    expect(buildTargetsFromBackendAssets({ ...assets, channels: [] }, [])).toEqual([]);
    const fallback: ShortLinkTarget[] = [{
      id: 'x', channelId: 'x', channelName: 'X', domain: 'd',
      ydisksAccountId: 'y', ydisksAccountName: 'Y', enabled: true,
    }];
    expect(buildTargetsFromBackendAssets({ ...assets, accounts: [] }, fallback)).toEqual(fallback);
  });
  it('无 ACTIVE 域名时使用全部域名', () => {
    const targets = buildTargetsFromBackendAssets({ ...assets, domains: [{ domainName: 'a.com', status: 'INACTIVE' }] }, []);
    expect(targets).toHaveLength(2);
    expect(targets[0].domain).toBe('a.com');
  });
  it('无任何域名时取 fallback 首个域名', () => {
    const fallback: ShortLinkTarget[] = [{
      id: 'ch1', channelId: 'ch1', channelName: 'Q群', domain: 'fb.com',
      ydisksAccountId: 'y-1', ydisksAccountName: 'Ydisks', enabled: true,
    }];
    const targets = buildTargetsFromBackendAssets({ ...assets, domains: [] }, fallback);
    expect(targets[0].domain).toBe('fb.com');
  });
  it('已有目标域名不可用时回落默认域名', () => {
    const fallback: ShortLinkTarget[] = [{
      id: 'ch1', channelId: 'ch1', channelName: 'Q群', domain: 'gone.com',
      ydisksAccountId: 'y-1', ydisksAccountName: 'Ydisks', enabled: true,
    }];
    const targets = buildTargetsFromBackendAssets(assets, fallback);
    expect(targets[0].domain).toBe('ydisks.com');
  });
});

describe('batchToRow / buildTargets 分支补充', () => {
  it('batch items/logs/shortLinkTargets 为 undefined 时序列化为空数组', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = batchToRow({ ...batch(), items: undefined as any, logs: undefined as any, shortLinkTargets: undefined as any });
    expect(row.itemsJson).toBe('[]');
    expect(row.logsJson).toBe('[]');
    expect(row.shortLinkTargetsJson).toBe('[]');
  });
  it('无域名且无 fallback 时返回空', () => {
    const noDomains: RustBackendAssetsSnapshot = {
      quota: { maxLinks: 100, usedLinks: 0, remainingLinks: 100, shortlinkAccessStatus: 'ACTIVE' },
      accounts: [{ id: 'y-1', name: 'Ydisks' }],
      channels: [{ id: 'ch1', name: 'Q群' }],
      domains: [],
    };
    expect(buildTargetsFromBackendAssets(noDomains, [])).toEqual([]);
  });
});
