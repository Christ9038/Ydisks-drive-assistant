import { describe, it, expect } from 'vitest';
import { csvEscape, buildHistoryCsv } from '../csv';
import type { HistoryRecord } from '../types';
import type { QueueItem } from '../../types';

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'I-1',
  provider: 'quark',
  sourceUrl: 'https://pan.quark.cn/s/abc',
  title: '课程,A',
  valid: true,
  status: 'done',
  step: '完成',
  progress: 100,
  ...over,
});

const history = (items: QueueItem[]): HistoryRecord => ({
  id: 'B-1',
  status: 'success',
  createdAt: '2026-01-01 10:00',
  total: items.length,
  completed: items.length,
  failed: 0,
  items,
});

describe('csvEscape', () => {
  it('用双引号包裹', () => {
    expect(csvEscape('abc')).toBe('"abc"');
  });
  it('内部双引号翻倍', () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
  });
  it('undefined 转空串', () => {
    expect(csvEscape(undefined)).toBe('""');
  });
  it('数字转字符串', () => {
    expect(csvEscape(42)).toBe('"42"');
  });
});

describe('buildHistoryCsv', () => {
  it('首行为表头', () => {
    const csv = buildHistoryCsv(history([]));
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toContain('平台');
    expect(firstLine).toContain('短链 URL');
    expect(firstLine).toContain('错误原因');
    expect(firstLine).not.toContain('原始链接');
  });

  it('转义标题中的逗号与引号', () => {
    const csv = buildHistoryCsv(history([item({ title: '课程,A"特惠' })]));
    expect(csv).toContain('"课程,A""特惠"');
  });

  it('无短链时输出单行兜底', () => {
    const csv = buildHistoryCsv(history([item()]));
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // 表头 + 1 行
  });

  it('转存账号输出账号备注名', () => {
    const csv = buildHistoryCsv(history([item({ accountId: 'internal-id', accountName: '百度PPT' })]));
    expect(csv).toContain('"百度PPT"');
    expect(csv).not.toContain('internal-id');
  });

  it('多短链展开为多行', () => {
    const csv = buildHistoryCsv(history([item({
      shortLinks: [
        { channelName: 'Q群', domain: 'ydisks.com', shortUrl: 'https://ydisks.com/a' },
        { channelName: 'TG', domain: 'ydisks.com', shortUrl: 'https://ydisks.com/b' },
      ],
    })]));
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // 表头 + 2 行
    expect(csv).toContain('Q群');
    expect(csv).toContain('TG');
  });
});
