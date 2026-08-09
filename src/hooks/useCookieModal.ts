//! Cookie 粘贴弹窗域：持有弹窗表单状态并提供打开 / 关闭 / 提交处理。
//!
//! 这是与其它业务状态低耦合的交互域：内部只管理弹窗自身的 4 个状态，
//! 提交时通过 `updateProviderAccount` 回调把保存结果写回账号域（由调用方注入）。

import { useState } from 'react';

import { providerLabels } from '../lib/constants';
import type { ProviderAccount } from '../types';

/**
 * Cookie 粘贴弹窗 hook。
 *
 * 返回弹窗渲染所需状态 + 三个处理函数。`submitCookieModal` 会用粘贴的 cookie
 * 调 `updateProviderAccount` 把账号标记为 connected。
 *
 * @param providerAccounts 当前账号列表（用于查找弹窗对应账号）
 * @param updateProviderAccount 账号更新回调（由账号域注入）
 */
export function useCookieModal(
  providerAccounts: ProviderAccount[],
  updateProviderAccount: (accountId: string, updater: (account: ProviderAccount) => ProviderAccount) => void,
) {
  const [cookieModalAccountId, setCookieModalAccountId] = useState<string | null>(null);
  const [cookieDraft, setCookieDraft] = useState('');
  const [cookieError, setCookieError] = useState('');
  const [cookieSaving, setCookieSaving] = useState(false);

  const cookieModalAccount = cookieModalAccountId
    ? providerAccounts.find((account) => account.id === cookieModalAccountId)
    : undefined;

  const openCookieModal = (accountId: string) => {
    const account = providerAccounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }
    setCookieModalAccountId(accountId);
    setCookieDraft(account.cookie ?? '');
    setCookieError('');
  };

  const closeCookieModal = () => {
    if (cookieSaving) {
      return;
    }
    setCookieModalAccountId(null);
    setCookieDraft('');
    setCookieError('');
  };

  /** 强制重置弹窗（无视 saving 态），用于账号删除 / 清理等外部状态变化时收尾。 */
  const resetCookieModal = () => {
    setCookieModalAccountId(null);
    setCookieDraft('');
    setCookieError('');
  };

  /** 当前弹窗是否正针对指定账号打开（用于账号删除 / 清理时联动关闭）。 */
  const isCookieModalOpenFor = (accountId: string) => cookieModalAccountId === accountId;

  const submitCookieModal = async () => {
    const account = providerAccounts.find((item) => item.id === cookieModalAccountId);
    if (!account) {
      return;
    }
    if (!cookieDraft.trim()) {
      setCookieError('请粘贴完整 Cookie');
      return;
    }

    setCookieSaving(true);
    setCookieError('');
    updateProviderAccount(account.id, (current) => ({
      ...current,
      cookie: cookieDraft,
      status: 'connected',
      loginName: `${providerLabels[current.provider]}已登录账号`,
      pendingReason: undefined,
      lastChecked: '刚刚',
    }));
    setCookieModalAccountId(null);
    setCookieDraft('');
    setCookieSaving(false);
  };

  return {
    cookieModalAccount,
    cookieDraft,
    cookieError,
    cookieSaving,
    openCookieModal,
    closeCookieModal,
    resetCookieModal,
    isCookieModalOpenFor,
    setCookieDraft,
    setCookieError,
    submitCookieModal,
  };
}
