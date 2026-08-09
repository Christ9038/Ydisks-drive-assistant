//! 状态页：批次执行监控。
//!
//! 顶部展示批次计数指标；列表展示各批次进度与控制按钮；点击详情进入 `BatchDetailPage`。

import { useState } from 'react';
import { Pause, Play, RotateCcw, XCircle } from 'lucide-react';

import { providerLabels } from '../lib/constants';
import type { ProviderAccount } from '../types';
import type { BatchRecord } from '../lib/types';
import { BatchStatusPill, EmptyState, Metric, Progress, SectionTitle } from '../components/ui';
import { BatchDetailPage } from './BatchDetailPage';

/** 状态页：监控运行 / 排队 / 暂停批次，支持暂停、继续、重试、取消，点击进入批次详情。 */
export function StatusPage({
  accounts,
  batches,
  onCancel,
  onContinue,
  onPause,
  onRetry,
  onRetryItem,
}: {
  accounts: ProviderAccount[];
  batches: BatchRecord[];
  onCancel: (batchId: string) => void;
  onContinue: (batchId: string) => void;
  onPause: (batchId: string) => void;
  onRetry: (batchId: string) => void;
  onRetryItem: (batchId: string, itemId: string) => void;
}) {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId);
  const runningCount = batches.filter((batch) => batch.status === 'running').length;
  const queuedCount = batches.filter((batch) => batch.status === 'queued').length;
  const manualCount = batches.filter((batch) => batch.status === 'manual_required').length;
  const waitingQuotaCount = batches.filter((batch) => batch.status === 'waiting_quota').length;
  const waitingRetryCount = batches.filter((batch) => batch.status === 'waiting_retry').length;

  if (selectedBatch) {
    return (
      <BatchDetailPage
        accounts={accounts}
        batch={selectedBatch}
        onBack={() => setSelectedBatchId(null)}
        onCancel={onCancel}
        onContinue={onContinue}
        onPause={onPause}
        onRetry={onRetry}
        onRetryItem={onRetryItem}
      />
    );
  }

  return (
    <div className="stack">
      <SectionTitle title="任务状态" />
      <div className="metric-grid">
        <Metric label="未完成批次" value={String(batches.length)} />
        <Metric label="执行中" value={String(runningCount)} tone="info" />
        <Metric label="平台排队" value={String(queuedCount)} tone={queuedCount > 0 ? 'warning' : 'good'} />
        <Metric label="需处理" value={String(manualCount + waitingQuotaCount + waitingRetryCount)} tone={manualCount + waitingQuotaCount + waitingRetryCount > 0 ? 'warning' : 'good'} />
      </div>
      {batches.length > 0 ? (
        <BatchMonitorTable batches={batches} onCancel={onCancel} onContinue={onContinue} onPause={onPause} onRetry={onRetry} onSelect={setSelectedBatchId} />
      ) : (
        <EmptyState title="暂无未结束批次" description="从任务页创建批次后，会在这里查看运行状态。" />
      )}
    </div>
  );
}

/** 批次监控表：每行展示批次概要、进度、状态与控制按钮。 */
function BatchMonitorTable({
  batches,
  onCancel,
  onContinue,
  onPause,
  onRetry,
  onSelect,
}: {
  batches: BatchRecord[];
  onCancel: (batchId: string) => void;
  onContinue: (batchId: string) => void;
  onPause: (batchId: string) => void;
  onRetry: (batchId: string) => void;
  onSelect: (batchId: string) => void;
}) {
  return (
    <div className="data-table task-monitor-table">
      <div className="table-row table-head">
        <span>批次</span>
        <span>平台</span>
        <span>账号</span>
        <span>资源</span>
        <span>进度</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      {batches.map((batch) => (
        <div className="table-row" key={batch.id}>
          <div className="resource-cell">
            <strong>{providerLabels[batch.provider]}转存</strong>
            <span>{batch.createdAt} · {batch.updatedAt}</span>
          </div>
          <span>{providerLabels[batch.provider]}</span>
          <div className="resource-cell">
            <strong>{batch.providerAccountName}</strong>
            <span>{batch.ydisksAccountName} · {batch.shortLinkTargetCount} 渠道</span>
          </div>
          <div className="batch-counts">
            <span>总 {batch.total}</span>
            <span>完成 {batch.completed}</span>
            <span>当前 {batch.currentIndex}/{batch.total}</span>
            {batch.queuePosition ? <span>排队 {batch.queuePosition}</span> : null}
            <span>待重试 {batch.retrying}</span>
            <span>等额 {batch.waitingQuota}</span>
          </div>
          <div className="resource-cell">
            <Progress value={batch.progress} />
            <span>{batch.currentStep}</span>
          </div>
          <BatchStatusPill status={batch.status} />
          <div className="task-actions">
            <button className="ghost-button compact" type="button" onClick={() => onSelect(batch.id)}>详情</button>
            {batch.status === 'paused' ? (
              <button className="ghost-button compact" type="button" onClick={() => onContinue(batch.id)}>
                <Play size={14} />
                继续
              </button>
            ) : batch.status === 'running' ? (
              <button className="ghost-button compact" type="button" onClick={() => onPause(batch.id)}>
                <Pause size={14} />
                暂停
              </button>
            ) : null}
            {batch.status !== 'queued' && batch.retrying > 0 ? (
              <button className="ghost-button compact" type="button" onClick={() => onRetry(batch.id)}>
                <RotateCcw size={14} />
                重试
              </button>
            ) : null}
            <button className="ghost-button compact danger" type="button" onClick={() => onCancel(batch.id)}>
              <XCircle size={14} />
              取消
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
