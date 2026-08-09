//! 历史页：查看已完成 / 失败批次记录，逐条导出 CSV。

import { useState } from 'react';
import { Archive, ArrowLeft } from 'lucide-react';

import { providerLabels } from '../lib/constants';
import { providerAccountLabel } from '../lib/guards';
import type { ProviderAccount } from '../types';
import type { HistoryRecord } from '../lib/types';
import { EmptyState, Metric, SectionTitle, StatusPill } from '../components/ui';
import { BatchLogPanel, ResultsTable } from '../components/tables';

const historyProviderLabel = (history: HistoryRecord) => {
  const provider = history.items.find((item) => item.provider !== 'unknown')?.provider;
  return provider && provider !== 'unknown' ? providerLabels[provider] : '未知平台';
};

const historyAccountLabel = (history: HistoryRecord, accounts: ProviderAccount[]) =>
  history.items.find((item) => item.accountName)?.accountName
  ?? providerAccountLabel(accounts, history.items.find((item) => item.accountId)?.accountId);

const historyDisplayTitle = (history: HistoryRecord, accounts: ProviderAccount[]) =>
  `${historyProviderLabel(history)}转存 · ${historyAccountLabel(history, accounts)}`;

/** 历史页：列出已完成 / 失败批次，点击查看明细并导出 CSV。 */
export function HistoryPage({ accounts, histories, onExport }: {
  accounts: ProviderAccount[];
  histories: HistoryRecord[];
  onExport: (history: HistoryRecord) => void;
}) {
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const selectedHistory = histories.find((history) => history.id === selectedHistoryId);

  if (selectedHistory) {
    return (
      <div className="stack">
        <div className="detail-head">
          <button className="ghost-button compact" type="button" onClick={() => setSelectedHistoryId(null)}>
            <ArrowLeft size={16} />
            返回
          </button>
          <div>
            <span className="eyebrow">历史结果</span>
            <h2>{historyDisplayTitle(selectedHistory, accounts)}</h2>
          </div>
          <StatusPill tone={selectedHistory.status === 'success' ? 'success' : 'danger'} label={selectedHistory.status === 'success' ? '成功' : '失败'} />
        </div>
        <div className="metric-grid">
          <Metric label="总数" value={String(selectedHistory.total)} />
          <Metric label="完成" value={String(selectedHistory.completed)} tone="good" />
          <Metric label="失败" value={String(selectedHistory.failed)} tone={selectedHistory.failed > 0 ? 'danger' : 'good'} />
          <Metric label="创建时间" value={selectedHistory.createdAt} />
        </div>
        <div className="action-row">
          <button className="ghost-button" type="button" onClick={() => onExport(selectedHistory)}>
            <Archive size={18} />
            导出 CSV
          </button>
        </div>
        <ResultsTable items={selectedHistory.items} />
        {selectedHistory.logs?.length ? <BatchLogPanel logs={selectedHistory.logs} /> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <SectionTitle title="历史记录" />
      {histories.length > 0 ? (
        <div className="history-list">
          {histories.map((batch) => (
            <div className="history-item" key={batch.id}>
              <div>
                <strong>{historyDisplayTitle(batch, accounts)}</strong>
                <span>{batch.createdAt}</span>
              </div>
              <StatusPill tone={batch.status === 'success' ? 'success' : 'danger'} label={batch.status === 'success' ? '成功' : '失败'} />
              <div className="history-counts">
                <span>总数 {batch.total}</span>
                <span>完成 {batch.completed}</span>
                <span>失败 {batch.failed}</span>
              </div>
              <button className="ghost-button compact" type="button" onClick={() => setSelectedHistoryId(batch.id)}>
                查看
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无历史记录" description="批次结束后会进入这里。" />
      )}
    </div>
  );
}
