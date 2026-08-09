//! 通用 UI 原子组件：标题、字段、徽标、进度条、提示框、空状态、主题切换。
//!
//! 这些组件均为受控、无副作用、无外部状态依赖，可在任意页面 / 弹窗中复用。
//! 仅依赖 `lib/constants` 的文案映射与 `lib/types` / `../types` 的类型。

import { memo } from 'react';
import { AlertTriangle, CheckCircle2, Database, Monitor, Moon, Sun, XCircle } from 'lucide-react';

import { batchStatusLabels, statusLabels } from '../lib/constants';
import type { BatchMonitor, TaskStatus } from '../types';
import type { ThemeMode } from '../lib/types';

/** 主题模式选项（日间 / 夜间 / 自动），供 `ThemeModeControl` 渲染分段控件。 */
const themeModeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: '日间', icon: Sun },
  { value: 'dark', label: '夜间', icon: Moon },
  { value: 'system', label: '自动', icon: Monitor },
];

/** 区块标题：主标题 + 可选副标题。 */
export const SectionTitle = memo(function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
});

/** 文本 / 密码字段；`onChange` 缺省时只读展示。`wide` 展开为整行宽度。 */
export function Field({
  label,
  onChange,
  secret = false,
  value,
  wide = false,
}: {
  label: string;
  onChange?: (value: string) => void;
  secret?: boolean;
  value: string;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'wide-field' : ''}`}>
      <span>{label}</span>
      <input type={secret ? 'password' : 'text'} value={value} readOnly={!onChange} onChange={(event) => onChange?.(event.target.value)} />
    </label>
  );
}

/** 受控下拉选择字段。 */
export function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
  return (
    <label className="field select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

/** 主题模式分段控件（日间 / 夜间 / 自动）。 */
export function ThemeModeControl({ value, onChange }: { value: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <div className="theme-mode-field">
      <span>显示模式</span>
      <div className="segmented-control" role="radiogroup" aria-label="显示模式">
        {themeModeOptions.map((option) => {
          const Icon = option.icon;
          const selected = option.value === value;
          return (
            <button
              aria-checked={selected}
              className={selected ? 'is-selected' : ''}
              key={option.value}
              role="radio"
              type="button"
              onClick={() => onChange(option.value)}
            >
              <Icon size={16} />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 指标卡：标签 + 数值，支持语义色调。 */
export const Metric = memo(function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warning' | 'danger' | 'info' }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
});

/** 通用状态徽标。 */
export const StatusPill = memo(function StatusPill({ tone, label, title }: { tone: 'success' | 'warning' | 'danger' | 'info'; label: string; title?: string }) {
  return <span className={`status-pill ${tone}`} title={title}>{label}</span>;
});

/** 单任务状态徽标：依据 `TaskStatus` 映射色调与文案。 */
export const TaskPill = memo(function TaskPill({ status }: { status: TaskStatus }) {
  const tone = status === 'done' ? 'success' : status === 'manual_required' || status === 'waiting_quota' || status === 'waiting_retry' ? 'warning' : 'info';
  return <StatusPill tone={tone} label={statusLabels[status]} />;
});

/** 批次状态徽标：依据批次状态映射色调与文案。 */
export const BatchStatusPill = memo(function BatchStatusPill({ status }: { status: BatchMonitor['status'] }) {
  const tone = status === 'manual_required' || status === 'waiting_quota' || status === 'waiting_retry' || status === 'queued' || status === 'paused' ? 'warning' : 'info';
  return <StatusPill tone={tone} label={batchStatusLabels[status]} />;
});

/** 进度条单元格：轨道填充宽度 + 百分比文字。 */
export const Progress = memo(function Progress({ value }: { value: number }) {
  return (
    <div className="progress-cell">
      <div className="progress-track">
        <span style={{ width: `${value}%` }} />
      </div>
      <em>{value}%</em>
    </div>
  );
});

/** 语义提示框（成功 / 警告 / 危险 / 信息），带图标与标题。 */
export const Callout = memo(function Callout({ tone, title, children }: { tone: 'success' | 'warning' | 'danger' | 'info'; title: string; children: string }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : Database;
  return (
    <div className={`callout ${tone}`}>
      <Icon size={18} />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
});

/** 空状态占位：图标 + 标题 + 描述。 */
export const EmptyState = memo(function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <CheckCircle2 size={34} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
});
