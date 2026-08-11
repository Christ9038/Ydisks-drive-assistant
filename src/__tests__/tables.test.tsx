import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportTable, QueueTable, BatchLogPanel, ResultsTable } from '../components/tables';
import type { ImportItem, ProviderAccount, QueueItem, ShortLinkResult } from '../types';
import type { BatchLogEntry } from '../lib/types';

const account = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'acc-1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主账号',
  status: 'connected',
  loginName: 'u1',
  purpose: '转存',
  lastChecked: '',
  hasCredential: true,
  ...over,
});

const importItem = (over: Partial<ImportItem> = {}): ImportItem => ({
  id: 'it-1',
  provider: 'quark',
  accountId: 'acc-1',
  sourceUrl: 'https://pan.quark.cn/s/abc',
  title: '资源一',
  valid: true,
  ...over,
});

const queueItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  ...importItem(),
  status: 'done',
  step: '已完成',
  progress: 100,
  shareUrl: 'https://pan.quark.cn/s/my1',
  ...over,
});

describe('ImportTable', () => {
  it('渲染表头与资源行', () => {
    render(<ImportTable items={[importItem()]} onDelete={() => {}} />);
    expect(screen.getByText('标题')).toBeTruthy();
    expect(screen.getByText('资源一')).toBeTruthy();
    expect(screen.getByText('https://pan.quark.cn/s/abc')).toBeTruthy();
  });
  it('点击删除触发 onDelete', () => {
    const onDelete = vi.fn();
    render(<ImportTable items={[importItem({ id: 'x' })]} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /删除/ }));
    expect(onDelete).toHaveBeenCalledWith('x');
  });
});

describe('QueueTable', () => {
  it('waiting_retry 行渲染重试按钮并触发 onRetry', () => {
    const onRetry = vi.fn();
    render(<QueueTable accounts={[account()]} items={[queueItem({ id: 'q1', status: 'waiting_retry' })]} onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: '重试' });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledWith('q1');
  });
  it('非 waiting_retry 行渲染详情按钮且不触发 onRetry', () => {
    const onRetry = vi.fn();
    render(<QueueTable accounts={[account()]} items={[queueItem({ id: 'q2', status: 'transferring' })]} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(onRetry).not.toHaveBeenCalled();
  });
  it('展示错误信息与缺失 shareUrl 的占位', () => {
    render(
      <QueueTable
        accounts={[]}
        items={[queueItem({ id: 'q3', status: 'manual_required', step: '需手动', error: '凭证失效', shareUrl: undefined })]}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('凭证失效')).toBeTruthy();
    expect(screen.getByText('-')).toBeTruthy();
  });
  it('账号未匹配时显示“未分配”', () => {
    render(<QueueTable accounts={[]} items={[queueItem({ accountId: 'nope' })]} onRetry={() => {}} />);
    expect(screen.getByText('未分配')).toBeTruthy();
  });
});

describe('BatchLogPanel', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  const logs: BatchLogEntry[] = [
    { id: 'l1', time: '00:01', tone: 'info', message: '开始', itemTitle: '资源一' },
    { id: 'l2', time: '00:02', tone: 'success', message: '完成', itemTitle: undefined },
  ];

  it('渲染日志条数与每条日志', () => {
    render(<BatchLogPanel logs={logs} />);
    expect(screen.getByText('2 条')).toBeTruthy();
    expect(screen.getByText('开始')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
    // itemTitle 为 undefined 时显示占位
    expect(screen.getByText('-')).toBeTruthy();
  });

  it('点击复制日志调用 clipboard', () => {
    render(<BatchLogPanel logs={logs} />);
    fireEvent.click(screen.getByRole('button', { name: '复制日志' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('空日志显示占位且复制按钮禁用', () => {
    render(<BatchLogPanel logs={[]} />);
    expect(screen.getByText('暂无运行日志')).toBeTruthy();
    expect((screen.getByRole('button', { name: '复制日志' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ResultsTable', () => {
  it('渲染短链列表', () => {
    const links: ShortLinkResult[] = [
      { channelName: 'Q群', domain: 'd.com', shortUrl: 'https://s/1' },
    ];
    render(<ResultsTable items={[queueItem({ id: 'r1', shortLinks: links })]} />);
    expect(screen.getByText('Q群: https://s/1')).toBeTruthy();
  });
  it('无短链但有错误时显示错误', () => {
    render(<ResultsTable items={[queueItem({ id: 'r2', shortLinks: [], error: '失败原因' })]} />);
    expect(screen.getByText('失败原因')).toBeTruthy();
  });
  it('无短链但有 originalLinkId 时显示未创建渠道短链', () => {
    render(<ResultsTable items={[queueItem({ id: 'r3', shortLinks: [], originalLinkId: 'L1', error: undefined })]} />);
    expect(screen.getByText('未创建渠道短链')).toBeTruthy();
  });
  it('无短链无 originalLinkId 时显示占位', () => {
    render(<ResultsTable items={[queueItem({ id: 'r4', shortLinks: undefined, originalLinkId: undefined })]} />);
    expect(screen.getByText('-')).toBeTruthy();
  });
});
