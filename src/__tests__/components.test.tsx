import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog, SelectField, ThemeModeControl } from '../App';

describe('ConfirmDialog', () => {
  it('渲染标题与消息', () => {
    render(
      <ConfirmDialog
        title="清除 API Key"
        message="确定清除已保存的 Key 吗？"
        confirmLabel="清除"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: '清除 API Key' })).toBeTruthy();
    expect(screen.getByText('确定清除已保存的 Key 吗？')).toBeTruthy();
    expect(screen.getByRole('button', { name: '清除' })).toBeTruthy();
  });

  it('点击确认按钮触发 onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="t" message="m" confirmLabel="确定" onConfirm={onConfirm} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('点击取消按钮与背景触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog title="t" message="m" confirmLabel="确定" onConfirm={() => {}} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('danger 时确认按钮使用 danger 样式', () => {
    render(
      <ConfirmDialog title="t" message="m" confirmLabel="删除" danger onConfirm={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole('button', { name: '删除' }).className).toContain('danger');
  });
});

describe('SelectField', () => {
  it('渲染选项并响应变更', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="渠道"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: '甲' },
          { value: 'b', label: '乙' },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('渠道'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('ThemeModeControl', () => {
  it('渲染三个模式按钮，当前选中高亮', () => {
    const onChange = vi.fn();
    render(<ThemeModeControl value="dark" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: '显示模式' });
    const buttons = group.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    const dark = screen.getByText('夜间').closest('button')!;
    expect(dark.className).toContain('is-selected');
  });

  it('点击切换模式触发 onChange', () => {
    const onChange = vi.fn();
    render(<ThemeModeControl value="light" onChange={onChange} />);
    fireEvent.click(screen.getByText('自动'));
    expect(onChange).toHaveBeenCalledWith('system');
  });
});
