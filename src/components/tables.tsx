//! 表格类展示组件：导入项表、队列表、运行日志面板、结果表。
//!
//! 均为受控展示组件：数据与回调通过 props 传入，无内部状态、无副作用。
//! 依赖 `lib/constants` 文案、`lib/guards` 账号标签工具与 `./ui` 的徽标 / 进度组件。

import { Trash2 } from 'lucide-react';

import { providerLabels } from '../lib/constants';
import { providerAccountLabel } from '../lib/guards';
import type { ImportItem, ProviderAccount, QueueItem } from '../types';
import type { BatchLogEntry } from '../lib/types';
import { Progress, TaskPill } from './ui';

/** 导入资源表：展示标题 / 源地址，逐行可删除。 */
export function ImportTable({ items, onDelete }: { items: ImportItem[]; onDelete: (itemId: string) => void }) {
  return (
    <div className="data-table import-table">
      <div className="table-row table-head">
        <span>标题</span>
        <span>源地址</span>
        <span>操作</span>
      </div>
      {items.map((item) => (
        <div className="table-row" key={item.id}>
          <span>{item.title}</span>
          <code>{item.sourceUrl}</code>
          <button className="ghost-button compact danger" type="button" onClick={() => onDelete(item.id)}>
            <Trash2 size={14} />
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

/** 批次队列表：顺序 / 平台 / 账号 / 资源 / 当前步骤 / 我的网盘链接 / 进度 / 状态 / 操作。 */
export function QueueTable({
  accounts,
  items,
  onRetry,
}: {
  accounts: ProviderAccount[];
  items: QueueItem[];
  onRetry: (itemId: string) => void;
}) {
  return (
    <div className="data-table queue-table">
      <div className="table-row table-head">
        <span>顺序</span>
        <span>平台</span>
        <span>账号</span>
        <span>资源</span>
        <span>当前步骤</span>
        <span>我的网盘链接</span>
        <span>进度</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      {items.map((item, index) => (
        <div className="table-row" key={item.id}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <span>{providerLabels[item.provider]}</span>
          <span>{providerAccountLabel(accounts, item.accountId)}</span>
          <div className="resource-cell">
            <strong>{item.title}</strong>
            <code>{item.sourceUrl}</code>
          </div>
          <div className="resource-cell">
            <span>{item.step}</span>
            {item.error ? <em className="error-text">{item.error}</em> : null}
          </div>
          <code>{item.shareUrl ?? '-'}</code>
          <Progress value={item.progress} />
          <TaskPill status={item.status} />
          <button className="ghost-button compact" type="button" onClick={() => item.status === 'waiting_retry' ? onRetry(item.id) : undefined}>
            {item.status === 'waiting_retry' ? '重试' : '详情'}
          </button>
        </div>
      ))}
    </div>
  );
}

/** 运行日志面板：逐条展示时间 / 标题 / 消息，支持一键复制全文。 */
export function BatchLogPanel({ logs }: { logs: BatchLogEntry[] }) {
  const copyLogs = () => {
    const text = logs
      .map((log) => `[${log.time}] ${log.tone.toUpperCase()} ${log.itemTitle ? `${log.itemTitle}：` : ''}${log.message}`)
      .join('\n');
    void navigator.clipboard?.writeText(text);
  };

  return (
    <section className="debug-log-panel">
      <div className="debug-log-head">
        <div>
          <span className="eyebrow">Debug</span>
          <h3>运行日志</h3>
        </div>
        <div className="debug-log-actions">
          <span>{logs.length} 条</span>
          <button className="ghost-button compact" type="button" disabled={logs.length === 0} onClick={copyLogs}>
            复制日志
          </button>
        </div>
      </div>
      {logs.length > 0 ? (
        <div className="debug-log-list">
          {logs.map((log) => (
            <div className={`debug-log-row ${log.tone}`} key={log.id}>
              <span>{log.time}</span>
              <strong>{log.itemTitle ?? '-'}</strong>
              <p>{log.message}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="provider-empty">暂无运行日志</div>
      )}
    </section>
  );
}

/** 结果表：资源 / 我的网盘链接 / 短链。 */
export function ResultsTable({ items }: { items: QueueItem[] }) {
  return (
    <div className="data-table result-table">
      <div className="table-row table-head">
        <span>资源</span>
        <span>我的网盘链接</span>
        <span>短链</span>
      </div>
      {items.map((item) => (
        <div className="table-row" key={item.id}>
          <span>{item.title}</span>
          <code>{item.shareUrl ?? '-'}</code>
          <div className="shortlink-list">
            {(item.shortLinks ?? []).length > 0
              ? item.shortLinks?.map((link) => (
                  <code key={link.shortUrl}>{link.channelName}: {link.shortUrl}</code>
                ))
              : <code>{item.error ?? (item.originalLinkId ? '未创建渠道短链' : '-')}</code>}
          </div>
        </div>
      ))}
    </div>
  );
}
