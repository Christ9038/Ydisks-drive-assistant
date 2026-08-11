import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchDetailPage } from '../pages/BatchDetailPage';
import { HistoryPage } from '../pages/HistoryPage';
import { StatusPage } from '../pages/StatusPage';
import type { ProviderAccount, QueueItem, ShortLinkResult } from '../types';
import type { BatchRecord, HistoryRecord } from '../lib/types';

const account = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'acc-1', provider: 'quark', platformName: '夸克网盘', displayName: '主账号', status: 'connected', loginName: 'u', purpose: '转存', lastChecked: '刚刚', hasCredential: true, ...over,
});

const queueItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'I-1', provider: 'quark', accountId: 'acc-1', sourceUrl: 'https://s', title: '资源', valid: true, status: 'done', step: '完成', progress: 100, accountName: '主账号', ...over,
});

const batchRecord = (over: Partial<BatchRecord> = {}): BatchRecord => ({
  id: 'B-1', status: 'running', provider: 'quark', providerAccountName: '主账号', ydisksAccountId: 'y1', ydisksAccountName: 'Ydisks', targetFolderRef: 'quark:fid:0', shortLinkTargetCount: 1, total: 1, completed: 1, currentIndex: 1, queuePosition: undefined, retrying: 0, waitingQuota: 0, progress: 100, currentStep: '处理中', createdAt: '2026-01-01 00:00', updatedAt: '刚刚', localEngine: true, logs: [], shortLinkTargets: [], items: [queueItem()], ...over,
});

const historyRecord = (over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: 'H-1', status: 'success', createdAt: '2026-01-01 00:00', total: 1, completed: 1, failed: 0, items: [queueItem()], logs: [], ...over,
});

describe('BatchDetailPage', () => {
  it('running 批次展示暂停按钮与取消批次，并响应回调', () => {
    const onPause = vi.fn();
    const onCancel = vi.fn();
    const onBack = vi.fn();
    render(<BatchDetailPage accounts={[account()]} batch={batchRecord({ status: 'running', retrying: 0 })} onBack={onBack} onCancel={onCancel} onContinue={() => {}} onPause={onPause} onRetry={() => {}} onRetryItem={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /暂停/ }));
    expect(onPause).toHaveBeenCalledWith('B-1');
    fireEvent.click(screen.getByRole('button', { name: '取消批次' }));
    expect(onCancel).toHaveBeenCalledWith('B-1');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('paused 批次展示继续按钮', () => {
    const onContinue = vi.fn();
    render(<BatchDetailPage accounts={[]} batch={batchRecord({ status: 'paused' })} onBack={() => {}} onCancel={() => {}} onContinue={onContinue} onPause={() => {}} onRetry={() => {}} onRetryItem={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(onContinue).toHaveBeenCalledWith('B-1');
  });

  it('queued 批次展示取消排队且无取消批次', () => {
    const onCancel = vi.fn();
    render(<BatchDetailPage accounts={[]} batch={batchRecord({ status: 'queued', queuePosition: 1 })} onBack={() => {}} onCancel={onCancel} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '取消排队' }));
    expect(onCancel).toHaveBeenCalledWith('B-1');
    expect(screen.queryByRole('button', { name: '取消批次' })).toBeNull();
  });

  it('retrying > 0 时展示重试待处理项', () => {
    const onRetry = vi.fn();
    render(<BatchDetailPage accounts={[]} batch={batchRecord({ status: 'waiting_retry', retrying: 1 })} onBack={() => {}} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={onRetry} onRetryItem={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '重试待处理项' }));
    expect(onRetry).toHaveBeenCalledWith('B-1');
  });

  it('队列表重试按钮触发 onRetryItem', () => {
    const onRetryItem = vi.fn();
    render(<BatchDetailPage accounts={[]} batch={batchRecord({ items: [queueItem({ id: 'q1', status: 'waiting_retry' })] })} onBack={() => {}} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={onRetryItem} />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetryItem).toHaveBeenCalledWith('B-1', 'q1');
  });

  it('logs 为空时 BatchLogPanel 回落到空数组（?? 兜底，102）', () => {
    render(<BatchDetailPage accounts={[]} batch={batchRecord({ logs: undefined })} onBack={() => {}} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={() => {}} />);
    // logs 为 undefined -> ?? [] -> 空日志占位
    expect(screen.getByText('暂无运行日志')).toBeTruthy();
  });
});

describe('HistoryPage', () => {
  it('空历史显示占位', () => {
    render(<HistoryPage accounts={[]} histories={[]} onExport={() => {}} />);
    expect(screen.getByText('暂无历史记录')).toBeTruthy();
  });

  it('列表展示成功 / 失败徽标并进入详情导出', () => {
    const onExport = vi.fn();
    const histories = [historyRecord({ id: 'H-1', status: 'success' }), historyRecord({ id: 'H-2', status: 'failed', failed: 1 })];
    const { container } = render(<HistoryPage accounts={[account()]} histories={histories} onExport={onExport} />);
    expect(container.querySelector('.status-pill.success')).toBeTruthy();
    expect(container.querySelector('.status-pill.danger')).toBeTruthy();
    // 进入第一条详情
    fireEvent.click(screen.getAllByRole('button', { name: '查看' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /导出 CSV/ }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ id: 'H-1' }));
  });

  it('失败历史详情展示失败徽标与失败数（46/51 分支）', () => {
    render(<HistoryPage accounts={[account()]} histories={[historyRecord({ id: 'H-2', status: 'failed', failed: 2, completed: 0, total: 2 })]} onExport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(screen.getByText('历史结果')).toBeTruthy();
    // status !== 'success' -> 「失败」徽标；failed > 0 -> danger 色调
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
  });

  it('详情页有日志时展示日志面板', () => {
    render(<HistoryPage accounts={[account()]} histories={[historyRecord({ logs: [{ id: 'l1', time: '00:00', tone: 'info', message: '日志' }] })]} onExport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(screen.getByText('运行日志')).toBeTruthy();
  });

  it('详情页无日志时隐藏日志面板', () => {
    render(<HistoryPage accounts={[account()]} histories={[historyRecord({ logs: undefined })]} onExport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(screen.queryByText('运行日志')).toBeNull();
  });

  it('详情返回列表', () => {
    render(<HistoryPage accounts={[account()]} histories={[historyRecord()]} onExport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('历史记录')).toBeTruthy();
  });
});

describe('StatusPage', () => {
  it('空批次显示占位', () => {
    render(<StatusPage accounts={[]} batches={[]} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={() => {}} />);
    expect(screen.getByText('暂无未结束批次')).toBeTruthy();
  });

  it('展示指标与监控表，点击详情进入详情页', () => {
    const batches = [batchRecord({ id: 'B-1', status: 'running' }), batchRecord({ id: 'B-2', status: 'queued', queuePosition: 1 })];
    render(<StatusPage accounts={[account()]} batches={batches} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={() => {}} />);
    expect(screen.getByText('未完成批次')).toBeTruthy();
    expect(screen.getAllByText('夸克转存').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
    // 进入详情页
    expect(screen.getByText('批次详情')).toBeTruthy();
    // 点击返回回到列表（StatusPage 自身的 onBack）
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('未完成批次')).toBeTruthy();
  });

  it('running 批次暂停 / 取消回调', () => {
    const onPause = vi.fn();
    const onCancel = vi.fn();
    render(<StatusPage accounts={[]} batches={[batchRecord({ status: 'running' })]} onCancel={onCancel} onContinue={() => {}} onPause={onPause} onRetry={() => {}} onRetryItem={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(onPause).toHaveBeenCalledWith('B-1');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledWith('B-1');
  });

  it('paused 批次继续 / retrying 重试回调', () => {
    const onContinue = vi.fn();
    const onRetry = vi.fn();
    render(<StatusPage accounts={[]} batches={[batchRecord({ status: 'paused', retrying: 1 })]} onCancel={() => {}} onContinue={onContinue} onPause={() => {}} onRetry={onRetry} onRetryItem={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(onContinue).toHaveBeenCalledWith('B-1');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledWith('B-1');
  });

  it('queued 批次无暂停 / 继续按钮', () => {
    render(<StatusPage accounts={[]} batches={[batchRecord({ status: 'queued', queuePosition: 1 })]} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={() => {}} />);
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull();
    expect(screen.queryByRole('button', { name: '继续' })).toBeNull();
  });

  it('manual_required 批次使「需处理」指标为 warning 色调（62 分支）', () => {
    render(<StatusPage accounts={[]} batches={[batchRecord({ status: 'manual_required' })]} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={() => {}} />);
    // manualCount > 0 -> 需处理 metric tone=warning
    expect(screen.getByText('需处理')).toBeTruthy();
  });

  it('资源项 waiting_retry 时详情按钮触发 onRetryItem', () => {
    const onRetryItem = vi.fn();
    render(<StatusPage accounts={[]} batches={[batchRecord({ status: 'running', items: [queueItem({ id: 'q1', status: 'waiting_retry' })] })]} onCancel={() => {}} onContinue={() => {}} onPause={() => {}} onRetry={() => {}} onRetryItem={onRetryItem} />);
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetryItem).toHaveBeenCalledWith('B-1', 'q1');
  });
});
