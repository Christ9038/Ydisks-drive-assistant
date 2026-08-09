//! 迅雷登录域：扫码授权弹窗 + 账号密码登录弹窗 + 风控验证面板。
//!
//! 持有 12 个弹窗表单状态及对应处理函数；扫码轮询 effect 在授权成功后把结果写回账号域。
//! 与账号域、toast 域的耦合通过注入的 `updateProviderAccount` / `setToast` 回调解耦。
//! `openXunleiPasswordLogin` / `openXunleiAuthorization` 暴露给 App 的 `handleProviderAdd` /
//! `handleProviderLogin` / `handleProviderCheck` 调用（这些处理需访问完整账号列表与登录捕获逻辑）。

import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

import {
  checkXunleiLogin,
  closeXunleiReviewWindow,
  loginXunleiPassword,
  openXunleiReviewWindow,
  startXunleiLogin,
} from '../lib/bridge';
import { formatBackendError, extractXunleiReviewState } from '../lib/format';
import { isTauriRuntime } from '../lib/bridge';
import type { ToastState } from './useToast';
import type { RustXunleiLoginQrResult, RustXunleiReviewCompleteEvent } from '../lib/types';
import type { ProviderAccount } from '../types';

/** 迅雷登录域 hook 返回值。 */
export interface XunleiLogin {
  // 扫码授权弹窗
  xunleiQrAccountId: string | null;
  xunleiQr: RustXunleiLoginQrResult | null;
  xunleiQrError: string;
  xunleiQrLoading: boolean;
  openXunleiAuthorization: (account: ProviderAccount) => Promise<void>;
  // 账号密码登录弹窗
  xunleiLoginAccountId: string | null;
  xunleiUsername: string;
  xunleiPassword: string;
  xunleiCreditKey: string;
  xunleiReviewUrl: string;
  xunleiRawReviewUrl: string;
  xunleiLoginError: string;
  xunleiLoginSaving: boolean;
  openXunleiPasswordLogin: (account: ProviderAccount) => void;
  closeXunleiPasswordLogin: () => void;
  submitXunleiPasswordLogin: () => Promise<void>;
  openXunleiReviewUrl: () => Promise<void>;
  resetXunleiQrModal: () => void;
  setXunleiQrError: (message: string) => void;
  clearXunleiLoginError: () => void;
  // setter（供弹窗表单受控）
  setXunleiUsername: (value: string) => void;
  setXunleiPassword: (value: string) => void;
  setXunleiCreditKey: (value: string) => void;
  // 扫码弹窗派生
  xunleiQrAccount: ProviderAccount | undefined;
  xunleiLoginAccount: ProviderAccount | undefined;
}

/**
 * 迅雷登录域 hook。
 *
 * @param providerAccounts 当前账号列表（查找弹窗对应账号 + 扫码轮询定位账号）
 * @param updateProviderAccount 账号更新回调（由账号域注入）
 * @param setToast Toast 反馈回调（由 toast 域注入）
 */
export function useXunleiLogin(
  providerAccounts: ProviderAccount[],
  updateProviderAccount: (accountId: string, updater: (account: ProviderAccount) => ProviderAccount) => void,
  setToast: (toast: ToastState | null) => void,
): XunleiLogin {
  // === 扫码授权弹窗 ===
  const [xunleiQrAccountId, setXunleiQrAccountId] = useState<string | null>(null);
  const [xunleiQr, setXunleiQr] = useState<RustXunleiLoginQrResult | null>(null);
  const [xunleiQrError, setXunleiQrErrorState] = useState('');
  const [xunleiQrLoading, setXunleiQrLoading] = useState(false);

  // === 账号密码登录弹窗 ===
  const [xunleiLoginAccountId, setXunleiLoginAccountId] = useState<string | null>(null);
  const [xunleiUsername, setXunleiUsername] = useState('');
  const [xunleiPassword, setXunleiPassword] = useState('');
  const [xunleiCreditKey, setXunleiCreditKey] = useState('');
  const [xunleiReviewUrl, setXunleiReviewUrl] = useState('');
  const [xunleiRawReviewUrl, setXunleiRawReviewUrl] = useState('');
  const [xunleiLoginError, setXunleiLoginError] = useState('');
  const [xunleiLoginSaving, setXunleiLoginSaving] = useState(false);

  const xunleiQrAccount = xunleiQrAccountId
    ? providerAccounts.find((account) => account.id === xunleiQrAccountId)
    : undefined;
  const xunleiLoginAccount = xunleiLoginAccountId
    ? providerAccounts.find((account) => account.id === xunleiLoginAccountId)
    : undefined;

  const openXunleiAuthorization = async (account: ProviderAccount) => {
    setXunleiQrAccountId(account.id);
    setXunleiQr(null);
    setXunleiQrErrorState('');
    setXunleiQrLoading(true);
    try {
      const qr = await startXunleiLogin(account);
      setXunleiQr(qr);
    } catch (error) {
      const message = formatBackendError(error);
      setXunleiQrErrorState(message);
      updateProviderAccount(account.id, (current) => ({
        ...current,
        status: 'manual_required',
        pendingReason: message,
        lastChecked: '刚刚',
      }));
    } finally {
      setXunleiQrLoading(false);
    }
  };

  const openXunleiPasswordLogin = (account: ProviderAccount) => {
    setXunleiLoginAccountId(account.id);
    setXunleiUsername('');
    setXunleiPassword('');
    setXunleiCreditKey('');
    setXunleiReviewUrl('');
    setXunleiRawReviewUrl('');
    setXunleiLoginError('');
  };

  const closeXunleiPasswordLogin = () => {
    if (xunleiLoginSaving) {
      return;
    }
    setXunleiLoginAccountId(null);
    setXunleiUsername('');
    setXunleiPassword('');
    setXunleiCreditKey('');
    setXunleiReviewUrl('');
    setXunleiRawReviewUrl('');
    setXunleiLoginError('');
  };

  /**
   * 用账号密码 + CreditKey 发起迅雷登录的核心异步逻辑。
   *
   * `submitXunleiPasswordLogin`（用户点登录）与二次验证完成后的自动续登都走这里。
   * 成功写回账号并关闭弹窗；失败时若需要二次验证则回填 review 链接 / creditKey。
   */
  const runPasswordLogin = async (
    accountId: string,
    username: string,
    password: string,
    creditKey: string,
  ) => {
    const account = providerAccounts.find((item) => item.id === accountId);
    if (!account || account.provider !== 'xunlei') {
      return;
    }
    setXunleiLoginSaving(true);
    setXunleiLoginError('');
    try {
      const result = await loginXunleiPassword(account, username, password, creditKey);
      updateProviderAccount(account.id, (current) => ({
        ...current,
        cookie: result.cookie,
        status: 'connected',
        loginName: result.loginName || '迅雷用户',
        pendingReason: undefined,
        lastChecked: '刚刚',
      }));
      setXunleiLoginAccountId(null);
      setXunleiUsername('');
      setXunleiPassword('');
      setXunleiCreditKey('');
      setXunleiReviewUrl('');
      setXunleiRawReviewUrl('');
      setToast({ message: '迅雷账号已登录', tone: 'success' });
    } catch (error) {
      const message = formatBackendError(error);
      const review = extractXunleiReviewState(error, message);
      if (review.needsReview) {
        setXunleiReviewUrl(review.reviewUrl);
        setXunleiRawReviewUrl(review.rawReviewUrl);
        if (review.creditKey) {
          setXunleiCreditKey(review.creditKey);
        }
        // 二次验证场景下不把原始错误当成「登录失败」展示，只提示需要二次验证（黄色警告）。
        setXunleiLoginError('该账号需要完成短信二次验证。请点击「打开验证页」完成验证，验证成功后将自动继续登录。');
        updateProviderAccount(account.id, (current) => ({
          ...current,
          status: 'manual_required',
          pendingReason: '需要二次验证',
          lastChecked: '刚刚',
        }));
        return;
      }
      setXunleiLoginError(message);
      updateProviderAccount(account.id, (current) => ({
        ...current,
        status: 'manual_required',
        pendingReason: message,
        lastChecked: '刚刚',
      }));
    } finally {
      setXunleiLoginSaving(false);
    }
  };

  const submitXunleiPasswordLogin = async () => {
    const account = providerAccounts.find((item) => item.id === xunleiLoginAccountId);
    if (!account || account.provider !== 'xunlei') {
      return;
    }
    if (!xunleiUsername.trim() || !xunleiPassword) {
      setXunleiLoginError('请填写迅雷账号和密码');
      return;
    }
    await runPasswordLogin(account.id, xunleiUsername, xunleiPassword, xunleiCreditKey);
  };

  const openXunleiReviewUrl = async () => {
    if (!xunleiReviewUrl || xunleiLoginSaving) {
      return;
    }
    try {
      await openXunleiReviewWindow(xunleiReviewUrl);
    } catch (error) {
      const message = formatBackendError(error);
      try {
        await navigator.clipboard?.writeText(xunleiReviewUrl);
        setToast({ message: '验证页打开失败，链接已复制', tone: 'danger' });
      } catch {
        setToast({ message: '验证页打开失败，请手动复制链接', tone: 'danger' });
      }
      setXunleiLoginError(message);
    }
  };

  /** 关闭扫码弹窗（清账号 / 二维码 / 错误），供外部登录成功后收尾。 */
  const resetXunleiQrModal = () => {
    setXunleiQrAccountId(null);
    setXunleiQr(null);
    setXunleiQrErrorState('');
  };

  /** 设置扫码弹窗错误信息（供 `handleProviderCheck` 在迅雷登录失败时回写）。 */
  const setXunleiQrError = (message: string) => setXunleiQrErrorState(message);

  /** 清空账号密码弹窗错误信息。 */
  const clearXunleiLoginError = () => setXunleiLoginError('');

  // 扫码授权轮询：每 2s 检查设备码登录状态，成功则写回账号 + 关闭弹窗。
  useEffect(() => {
    if (!xunleiQrAccountId || !xunleiQr || xunleiQrLoading) {
      return undefined;
    }

    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      const account = providerAccounts.find((item) => item.id === xunleiQrAccountId);
      if (!account || account.provider !== 'xunlei') {
        return;
      }

      try {
        const check = await checkXunleiLogin(account);
        if (stopped) {
          return;
        }
        if (check.status !== 'connected' || !check.result) {
          timer = window.setTimeout(poll, 2000);
          return;
        }
        const result = check.result;
        updateProviderAccount(account.id, (current) => ({
          ...current,
          cookie: result.cookie,
          status: 'connected',
          loginName: result.loginName || '迅雷用户',
          pendingReason: undefined,
          lastChecked: '刚刚',
        }));
        setXunleiQrAccountId(null);
        setXunleiQr(null);
        setXunleiQrErrorState('');
        setToast({ message: '迅雷账号已登录', tone: 'success' });
      } catch (error) {
        if (stopped) {
          return;
        }
        const message = formatBackendError(error);
        setXunleiQrErrorState(message);
        updateProviderAccount(account.id, (current) => ({
          ...current,
          status: 'manual_required',
          pendingReason: message,
          lastChecked: '刚刚',
        }));
        timer = window.setTimeout(poll, 2000);
      }
    };

    timer = window.setTimeout(poll, 2000);
    return () => {
      stopped = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [providerAccounts, xunleiQr, xunleiQrAccountId, xunleiQrLoading, updateProviderAccount, setToast]);

  // 二次验证完成监听：验证窗口成功后后端广播 xunlei-review-complete，自动回填 CreditKey、
  // 关闭验证窗口并用原账号密码自动续登——用户无需手动复制 CreditKey 再点登录。
  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }
    let unlisten: (() => void) | undefined;
    void listen<RustXunleiReviewCompleteEvent>('xunlei-review-complete', async (event) => {
      const { windowLabel, creditKey } = event.payload;
      // 先关闭验证窗口（无论后续续登是否进行）。
      void closeXunleiReviewWindow(windowLabel);
      // 仅在账号密码登录弹窗打开、且本次登录触发了二次验证流程时自动续登。
      if (!xunleiLoginAccountId || !xunleiReviewUrl || !creditKey) {
        if (!creditKey) {
          setXunleiLoginError('验证完成，但页面未返回 CreditKey，请手动复制后点登录。');
        }
        return;
      }
      setXunleiCreditKey(creditKey);
      setXunleiReviewUrl('');
      setXunleiRawReviewUrl('');
      setXunleiLoginError('验证完成，正在自动继续登录……');
      await runPasswordLogin(xunleiLoginAccountId, xunleiUsername, xunleiPassword, creditKey);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      unlisten?.();
    };
    // runPasswordLogin 依赖的 state 经其闭包读取最新值，此处仅在关键触发条件变化时重建监听。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xunleiLoginAccountId, xunleiReviewUrl, xunleiUsername, xunleiPassword]);

  return {
    xunleiQrAccountId,
    xunleiQr,
    xunleiQrError,
    xunleiQrLoading,
    openXunleiAuthorization,
    xunleiLoginAccountId,
    xunleiUsername,
    xunleiPassword,
    xunleiCreditKey,
    xunleiReviewUrl,
    xunleiRawReviewUrl,
    xunleiLoginError,
    xunleiLoginSaving,
    openXunleiPasswordLogin,
    closeXunleiPasswordLogin,
    submitXunleiPasswordLogin,
    openXunleiReviewUrl,
    resetXunleiQrModal,
    setXunleiQrError,
    clearXunleiLoginError,
    setXunleiUsername,
    setXunleiPassword,
    setXunleiCreditKey,
    xunleiQrAccount,
    xunleiLoginAccount,
  };
}
