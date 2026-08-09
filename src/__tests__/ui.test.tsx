import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SectionTitle,
  Field,
  SelectField,
  ThemeModeControl,
  Metric,
  StatusPill,
  TaskPill,
  BatchStatusPill,
  Progress,
  Callout,
  EmptyState,
} from '../components/ui';
import type { TaskStatus } from '../types';
import type { BatchMonitor } from '../types';

describe('SectionTitle', () => {
  it('渲染主标题与副标题', () => {
    render(<SectionTitle title="转存任务" subtitle="配置资源" />);
    expect(screen.getByText('转存任务')).toBeTruthy();
    expect(screen.getByText('配置资源')).toBeTruthy();
  });
  it('无副标题时不渲染 p', () => {
    render(<SectionTitle title="仅标题" />);
    expect(screen.getByText('仅标题')).toBeTruthy();
    expect(screen.queryByText('配置资源')).toBeNull();
  });
});

describe('Field', () => {
  it('可编辑文本字段触发 onChange', () => {
    const onChange = vi.fn();
    render(<Field label="账号" value="a" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('缺省 onChange 时只读且不报错', () => {
    render(<Field label="只读" value="v" />);
    const input = screen.getByLabelText('只读') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
  });
  it('secret 渲染为密码框', () => {
    render(<Field label="密钥" value="s" secret onChange={() => {}} />);
    expect((screen.getByLabelText('密钥') as HTMLInputElement).type).toBe('password');
  });
  it('wide 展开整行宽度', () => {
    render(<Field label="宽" value="v" wide onChange={() => {}} />);
    expect(document.querySelector('.wide-field')).toBeTruthy();
  });
});

describe('SelectField', () => {
  it('disabled 时禁用并附加样式', () => {
    render(<SelectField label="平台" value="x" onChange={() => {}} options={[]} disabled />);
    const select = screen.getByLabelText('平台') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.closest('.select-field')!.className).toContain('is-disabled');
  });
});

describe('ThemeModeControl', () => {
  it('切换到日间触发 onChange', () => {
    const onChange = vi.fn();
    render(<ThemeModeControl value="system" onChange={onChange} />);
    fireEvent.click(screen.getByText('日间'));
    expect(onChange).toHaveBeenCalledWith('light');
  });
});

describe('Metric', () => {
  it.each(['neutral', 'good', 'warning', 'danger', 'info'] as const)('渲染 %s 色调', (tone) => {
    const { container } = render(<Metric label="剩余" value="10" tone={tone} />);
    expect(container.querySelector(`.metric-${tone}`)).toBeTruthy();
  });
  it('缺省色调为 neutral', () => {
    const { container } = render(<Metric label="剩余" value="10" />);
    expect(container.querySelector('.metric-neutral')).toBeTruthy();
  });
});

describe('StatusPill', () => {
  it('渲染 label 与 title', () => {
    render(<StatusPill tone="success" label="成功" title="点击查看" />);
    expect(screen.getByText('成功').getAttribute('title')).toBe('点击查看');
  });
});

describe('TaskPill', () => {
  it.each<[TaskStatus, string]>([
    ['done', 'success'],
    ['manual_required', 'warning'],
    ['waiting_quota', 'warning'],
    ['waiting_retry', 'warning'],
    ['transferring', 'info'],
  ])('状态 %s 映射 %s 色调', (status, tone) => {
    const { container } = render(<TaskPill status={status} />);
    expect(container.querySelector(`.status-pill.${tone}`)).toBeTruthy();
  });
});

describe('BatchStatusPill', () => {
  it.each<[BatchMonitor['status'], string]>([
    ['manual_required', 'warning'],
    ['waiting_quota', 'warning'],
    ['waiting_retry', 'warning'],
    ['queued', 'warning'],
    ['paused', 'warning'],
    ['running', 'info'],
  ])('批次状态 %s 映射 %s 色调', (status, tone) => {
    const { container } = render(<BatchStatusPill status={status} />);
    expect(container.querySelector(`.status-pill.${tone}`)).toBeTruthy();
  });
});

describe('Progress', () => {
  it('渲染填充宽度与百分比', () => {
    const { container } = render(<Progress value={42} />);
    expect(container.querySelector('.progress-track span')!.getAttribute('style')).toContain('width: 42%');
    expect(screen.getByText('42%')).toBeTruthy();
  });
});

describe('Callout', () => {
  it.each(['success', 'danger', 'warning', 'info'] as const)('渲染 %s 色调提示框', (tone) => {
    render(<Callout tone={tone} title="提示">正文内容</Callout>);
    expect(document.querySelector(`.callout.${tone}`)).toBeTruthy();
    expect(screen.getByText('提示')).toBeTruthy();
    expect(screen.getByText('正文内容')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('渲染标题与描述', () => {
    render(<EmptyState title="无数据" description="请新建任务" />);
    expect(screen.getByText('无数据')).toBeTruthy();
    expect(screen.getByText('请新建任务')).toBeTruthy();
  });
});
