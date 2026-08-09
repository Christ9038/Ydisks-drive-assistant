//! 批次详情页：单个批次的指标 / 控制按钮 / 运行日志 / 队列表。

import { ArrowLeft, Pause, Play, RotateCcw, XCircle } from 'lucide-react';

import { providerLabels } from '../lib/constants';
import type { ProviderAccount } from '../types';
import type { BatchRecord } from '../lib/types';
import { BatchStatusPill, Metric } from '../components/ui';
import { BatchLogPanel, QueueTable } from '../components/tables';

/** 批次详情页：单批次的指标 / 控制按钮（暂停 / 继续 / 重试 / 取消）/ 运行日志 / 队列表。 */
export function BatchDetailPage({
  accounts,
  batch,
  onBack,
  onCancel,
  onContinue,
  onPause,
  onRetry,
  onRetryItem,
}: {
  accounts: ProviderAccount[];
  batch: BatchRecord;
  onBack: () => void;
  onCancel: (batchId: string) => void;
  onContinue: (batchId: string) => void;
  onPause: (batchId: string) => void;
  onRetry: (batchId: string) => void;
  onRetryItem: (batchId: string, itemId: string) => void;
}) {
  return (
    <div className="stack">
      <div className="detail-head">
        <button className="ghost-button compact" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          返回
        </button>
        <div>
          <span className="eyebrow">批次详情</span>
          <h2>{providerLabels[batch.provider]}转存批次</h2>
        </div>
        <BatchStatusPill status={batch.status} />
      </div>
      <div className="metric-grid">
        <Metric label="平台" value={providerLabels[batch.provider]} tone="info" />
        <Metric label="转存账号" value={batch.providerAccountName} />
        <Metric label="短链渠道" value={String(batch.shortLinkTargetCount)} />
        <Metric label="进度" value={`${batch.progress}%`} tone="info" />
      </div>
      <div className="batch-detail-grid">
        <div>
          <span>创建时间</span>
          <strong>{batch.createdAt}</strong>
        </div>
        <div>
          <span>Ydisks 账号</span>
          <strong>{batch.ydisksAccountName}</strong>
        </div>
        <div>
          <span>资源统计</span>
          <strong>总 {batch.total} / 完成 {batch.completed} / 待重试 {batch.retrying} / 等待 {batch.waitingQuota}</strong>
        </div>
        <div>
          <span>处理模式</span>
          <strong>串行，第 {batch.currentIndex}/{batch.total} 条</strong>
        </div>
        <div>
          <span>当前阶段</span>
          <strong>{batch.currentStep}</strong>
        </div>
      </div>
      <div className="queue-toolbar">
        {batch.status === 'queued' ? (
          <button className="ghost-button danger" type="button" onClick={() => onCancel(batch.id)}>
            <XCircle size={18} />
            取消排队
          </button>
        ) : batch.status === 'paused' ? (
          <button className="primary-button" type="button" onClick={() => onContinue(batch.id)}>
            <Play size={18} />
            继续
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={() => onPause(batch.id)}>
            <Pause size={18} />
            暂停
          </button>
        )}
        {batch.status !== 'queued' && batch.retrying > 0 ? (
          <button className="ghost-button" type="button" onClick={() => onRetry(batch.id)}>
            <RotateCcw size={18} />
            重试待处理项
          </button>
        ) : null}
      {batch.status !== 'queued' ? (
          <button className="ghost-button danger" type="button" onClick={() => onCancel(batch.id)}>
            <XCircle size={18} />
            取消批次
          </button>
        ) : null}
      </div>
      <BatchLogPanel logs={batch.logs ?? []} />
      <QueueTable accounts={accounts} items={batch.items} onRetry={(itemId) => onRetryItem(batch.id, itemId)} />
    </div>
  );
}
