import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShortLinkTargets } from '../components/fields';
import type { ShortLinkTarget } from '../types';
import type { DomainOption } from '../lib/types';

const target = (over: Partial<ShortLinkTarget> = {}): ShortLinkTarget => ({
  id: 'T-1',
  channelId: 'C-1',
  channelName: '小红书',
  domain: 't.ydisks.cn',
  enabled: false,
  ydisksAccountId: '',
  ydisksAccountName: '',
  ...over,
});

const domain = (over: Partial<DomainOption> = {}): DomainOption => ({
  domainName: 't.ydisks.cn',
  status: 'ACTIVE',
  ...over,
});

describe('ShortLinkTargets', () => {
  it('未连接后台（disabled）时显示仅转存引导，不渲染渠道开关', () => {
    render(
      <ShortLinkTargets
        disabled
        domainOptions={[domain()]}
        targets={[target()]}
        onChangeDomain={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText(/未连接 Ydisks 后台，本次仅转存/)).toBeTruthy();
    // 渠道开关不应渲染
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('已连接后台且无渠道时显示暂无短链渠道', () => {
    render(
      <ShortLinkTargets
        domainOptions={[domain()]}
        targets={[]}
        onChangeDomain={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('暂无短链渠道')).toBeTruthy();
  });

  it('已连接后台且有渠道时渲染渠道开关与域名选择', () => {
    render(
      <ShortLinkTargets
        domainOptions={[domain()]}
        targets={[target({ enabled: true })]}
        onChangeDomain={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('小红书')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });

  it('渠道开关点击触发 onToggle', () => {
    const onToggle = vi.fn();
    render(
      <ShortLinkTargets
        domainOptions={[domain()]}
        targets={[target({ enabled: false })]}
        onChangeDomain={() => {}}
        onToggle={onToggle}
      />,
    );
    (screen.getByRole('checkbox') as HTMLInputElement).click();
    expect(onToggle).toHaveBeenCalledWith('T-1');
  });

  it('全选与取消全选触发批量切换', () => {
    const onToggleAll = vi.fn();
    render(
      <ShortLinkTargets
        domainOptions={[domain()]}
        targets={[target({ enabled: false }), target({ id: 'T-2', channelId: 'C-2', channelName: '抖音', enabled: true })]}
        onChangeDomain={() => {}}
        onToggle={() => {}}
        onToggleAll={onToggleAll}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }));
    expect(onToggleAll).toHaveBeenNthCalledWith(1, true);
    expect(onToggleAll).toHaveBeenNthCalledWith(2, false);
  });

  it('全部渠道已选中时禁用全选，全部未选中时禁用取消全选', () => {
    const { rerender } = render(
      <ShortLinkTargets
        domainOptions={[domain()]}
        targets={[target({ enabled: true })]}
        onChangeDomain={() => {}}
        onToggle={() => {}}
        onToggleAll={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: '全选' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消全选' }) as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <ShortLinkTargets
        domainOptions={[domain()]}
        targets={[target({ enabled: false })]}
        onChangeDomain={() => {}}
        onToggle={() => {}}
        onToggleAll={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: '全选' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '取消全选' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('无可用域名时渠道域名下拉显示占位', () => {
    const onChangeDomain = vi.fn();
    render(
      <ShortLinkTargets
        domainOptions={[]}
        targets={[target({ enabled: true })]}
        onChangeDomain={onChangeDomain}
        onToggle={() => {}}
      />,
    );
    const select = screen.getByLabelText('小红书短链域名') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.getByText('暂无可用域名')).toBeTruthy();
  });
});
