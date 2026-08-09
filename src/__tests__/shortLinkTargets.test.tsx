import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
