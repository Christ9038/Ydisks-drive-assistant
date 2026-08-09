import { describe, it, expect } from 'vitest';
import {
  isProviderKey,
  isProviderStatus,
  isThemeMode,
  platformNameOf,
  providerOfAccountTypeName,
  providerAccountLabel,
  isProviderAccountUsable,
  isBlockingStatus,
  isActiveQueueStatus,
  isXunleiAuthorizationPendingMessage,
  isCredentialErrorMessage,
  isAwaitingProviderLogin,
  normalizeStoredProviderAccounts,
  remainingLinksOf,
} from '../guards';
import type { ProviderAccount } from '../../types';

const account = (over: Partial<ProviderAccount> = {}): ProviderAccount => ({
  id: 'quark-1',
  provider: 'quark',
  platformName: '夸克网盘',
  displayName: '主账号',
  status: 'connected',
  loginName: 'user',
  purpose: '',
  lastChecked: '-',
  cookie: 'cookie-value',
  ...over,
});

describe('类型守卫', () => {
  it('isProviderKey', () => {
    expect(isProviderKey('quark')).toBe(true);
    expect(isProviderKey('unknown')).toBe(false);
    expect(isProviderKey(123)).toBe(false);
  });
  it('isProviderStatus', () => {
    expect(isProviderStatus('connected')).toBe(true);
    expect(isProviderStatus('expired')).toBe(true);
    expect(isProviderStatus('manual_required')).toBe(true);
    expect(isProviderStatus('other')).toBe(false);
  });
  it('isThemeMode', () => {
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('other')).toBe(false);
  });
});

describe('platformNameOf', () => {
  it('返回「XX网盘」', () => {
    expect(platformNameOf('quark')).toBe('夸克网盘');
    expect(platformNameOf('baidu')).toBe('百度网盘');
    expect(platformNameOf('xunlei')).toBe('迅雷网盘');
  });
});

describe('providerOfAccountTypeName', () => {
  it('按品牌关键词映射平台', () => {
    expect(providerOfAccountTypeName('夸克网盘')).toBe('quark');
    expect(providerOfAccountTypeName('百度网盘')).toBe('baidu');
    expect(providerOfAccountTypeName('迅雷网盘')).toBe('xunlei');
  });
  it('无品牌返回 null', () => {
    expect(providerOfAccountTypeName('其它网盘')).toBeNull();
    expect(providerOfAccountTypeName(undefined)).toBeNull();
  });
});

describe('providerAccountLabel', () => {
  it('匹配账号返回显示名', () => {
    expect(providerAccountLabel([account()], 'quark-1')).toBe('主账号');
  });
  it('未匹配返回「未分配」', () => {
    expect(providerAccountLabel([account()], 'other')).toBe('未分配');
    expect(providerAccountLabel([], undefined)).toBe('未分配');
  });
});

describe('isProviderAccountUsable', () => {
  it('connected 且有 cookie 可用', () => {
    expect(isProviderAccountUsable(account())).toBe(true);
  });
  it('expired 或无 cookie 不可用', () => {
    expect(isProviderAccountUsable(account({ status: 'expired' }))).toBe(false);
    expect(isProviderAccountUsable(account({ cookie: undefined }))).toBe(false);
  });
});

describe('状态判定', () => {
  it('isBlockingStatus：非 queued 即阻塞', () => {
    expect(isBlockingStatus('running')).toBe(true);
    expect(isBlockingStatus('queued')).toBe(false);
  });
  it('isActiveQueueStatus：仅活跃处理状态', () => {
    expect(isActiveQueueStatus('transferring')).toBe(true);
    expect(isActiveQueueStatus('pending')).toBe(true);
    expect(isActiveQueueStatus('done')).toBe(false);
    expect(isActiveQueueStatus('waiting_quota')).toBe(false);
  });
  it('isXunleiAuthorizationPendingMessage', () => {
    expect(isXunleiAuthorizationPendingMessage('扫码未完成')).toBe(true);
    expect(isXunleiAuthorizationPendingMessage('authorization_pending')).toBe(true);
    expect(isXunleiAuthorizationPendingMessage('ok')).toBe(false);
  });
  it('isCredentialErrorMessage', () => {
    expect(isCredentialErrorMessage('Cookie 过期')).toBe(true);
    expect(isCredentialErrorMessage('登录失效')).toBe(true);
    expect(isCredentialErrorMessage('网络错误')).toBe(false);
  });
  it('isAwaitingProviderLogin', () => {
    expect(isAwaitingProviderLogin(account({ status: 'manual_required', pendingReason: '请完成官方窗口登录' }))).toBe(true);
    expect(isAwaitingProviderLogin(account({ status: 'manual_required', pendingReason: '其它原因' }))).toBe(false);
    expect(isAwaitingProviderLogin(account({ status: 'connected' }))).toBe(false);
  });
});

describe('remainingLinksOf', () => {
  it('剩余额度最小为 0', () => {
    expect(remainingLinksOf({ maxLinks: 10, usedLinks: 3 })).toBe(7);
    expect(remainingLinksOf({ maxLinks: 5, usedLinks: 8 })).toBe(0);
  });
});

describe('normalizeStoredProviderAccounts', () => {
  it('过滤非法对象与 demo 账号并补默认值', () => {
    const result = normalizeStoredProviderAccounts([
      { id: 'quark-1', provider: 'quark', displayName: '主', status: 'connected', cookie: 'c' },
      { id: 'quark-main', provider: 'quark' }, // demo 账号被剔除
      { id: 'bad', provider: 'invalid' }, // 平台非法被剔除
      'not-an-object',
      null,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('主');
    expect(result[0].platformName).toBe('夸克网盘');
  });
  it('缺字段时补默认值', () => {
    const result = normalizeStoredProviderAccounts([{ id: 'baidu-1', provider: 'baidu' }]);
    expect(result[0].displayName).toBe('百度账号');
    expect(result[0].status).toBe('expired');
    expect(result[0].loginName).toBe('未登录');
  });
  it('非数组返回空', () => {
    expect(normalizeStoredProviderAccounts(null)).toEqual([]);
    expect(normalizeStoredProviderAccounts('x')).toEqual([]);
  });
});
