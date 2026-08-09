//! 后台连接域：API Key、连接状态、额度、后台资产（账号 / 渠道 / 域名 / 短链目标）。
//!
//! 持有 7 个状态并提供「检测连接」「立即清除 Key」两个处理。检测成功后自动拉取后台资产；
//! 启动时若本地已保存 Key 则自动重新检测以恢复连接。Toast 反馈由调用方注入的 `setToast` 上报。

import { useEffect, useRef, useState } from 'react';

import {
  loadBackendAssets,
  loadBackendQuota,
  isTauriRuntime,
  waitForNextPaint,
} from '../lib/bridge';
import { formatBackendError } from '../lib/format';
import { buildTargetsFromBackendAssets } from '../lib/mappers';
import { emptyQuota } from '../lib/constants';
import {
  clearStoredApiKey,
  loadStoredApiKey,
  saveStoredApiKey,
} from '../lib/storage';
import type { ToastState } from './useToast';
import type {
  DomainOption,
  QuotaState,
  YdisksAccountOption,
} from '../lib/types';
import type { ShortLinkTarget } from '../types';

/** 后台连接状态机：待检测 / 检测中 / 已连接 / 未连接。 */
export type ApiConnectionStatus = 'idle' | 'checking' | 'connected' | 'failed';

/** 后台连接域 hook 返回值。 */
export interface ApiConnection {
  apiKey: string;
  apiConnectionStatus: ApiConnectionStatus;
  apiError: string;
  quotaState: QuotaState;
  ydisksAccounts: YdisksAccountOption[];
  domainOptions: DomainOption[];
  shortlinkOptions: ShortLinkTarget[];
  detectApiKey: () => Promise<void>;
  setApiKeyDraft: (nextApiKey: string) => void;
  clearApiKeyImmediately: () => void;
  /** 本地乐观扣减短链用量（`usedLinks += count`），用于创建短链成功后即时刷新余额显示。 */
  deductQuotaLocally: (count: number) => void;
  /** 从后台重新拉取额度并覆盖本地状态（用于一批转存结束后与线上同步）。 */
  syncQuotaFromBackend: () => Promise<void>;
}

/**
 * 后台连接域 hook。
 *
 * @param setToast Toast 反馈回调（由 toast 域注入）
 */
export function useApiConnection(setToast: (toast: ToastState | null) => void): ApiConnection {
  const [apiKey, setApiKey] = useState(loadStoredApiKey);
  const [apiConnectionStatus, setApiConnectionStatus] = useState<ApiConnectionStatus>(loadStoredApiKey().trim() ? 'idle' : 'failed');
  const [apiError, setApiError] = useState('');
  const [quotaState, setQuotaState] = useState<QuotaState>(emptyQuota);
  const [ydisksAccounts, setYdisksAccounts] = useState<YdisksAccountOption[]>([]);
  const [domainOptions, setDomainOptions] = useState<DomainOption[]>([]);
  const [shortlinkOptions, setShortlinkOptions] = useState<ShortLinkTarget[]>([]);

  const loadBackendAssetsSilently = (nextApiKey: string) => {
    void loadBackendAssets(nextApiKey)
      .then((assets) => {
        setYdisksAccounts(assets.accounts);
        setDomainOptions(assets.domains);
        setShortlinkOptions((current) => buildTargetsFromBackendAssets(assets, current));
      })
      .catch(() => {
        setYdisksAccounts([]);
        setDomainOptions([]);
        setShortlinkOptions([]);
      });
  };

  const detectApiKey = async () => {
    const nextApiKey = apiKey.trim();
    if (!nextApiKey) {
      setApiConnectionStatus('failed');
      setApiError('');
      return;
    }

    setApiConnectionStatus('checking');
    setApiError('');
    setToast({ message: '正在检测后台连接...', tone: 'info' });
    await waitForNextPaint();
    try {
      const quota = await loadBackendQuota(nextApiKey);
      setApiKey(nextApiKey);
      saveStoredApiKey(nextApiKey);
      setApiConnectionStatus('connected');
      setApiError('');
      setQuotaState({
        maxLinks: quota.maxLinks,
        usedLinks: quota.usedLinks,
        shortlinkAccessStatus: quota.shortlinkAccessStatus,
      });
      setToast({ message: `后台已连接，剩余短链 ${quota.remainingLinks}`, tone: 'success' });
      loadBackendAssetsSilently(nextApiKey);
    } catch (error) {
      const message = formatBackendError(error);
      setApiConnectionStatus('failed');
      setApiError(message);
      setToast({ message, tone: 'danger' });
    }
  };

  const clearApiKeyImmediately = () => {
    clearStoredApiKey();
    setApiKey('');
    setApiConnectionStatus('failed');
    setApiError('');
  };

  /**
   * 顶栏输入框编辑 API Key 时调用：更新 key 并把连接状态重置为 idle / failed，
   * 清空旧错误，等待用户点击「检测」。空串视为未连接。
   */
  const setApiKeyDraft = (nextApiKey: string) => {
    setApiKey(nextApiKey);
    setApiConnectionStatus(nextApiKey.trim().length > 0 ? 'idle' : 'failed');
    setApiError('');
  };

  /**
   * 本地乐观扣减短链用量：`usedLinks += count`，使「剩余额度」即时下降。
   *
   * 仅修改本地 `quotaState`，不访问后台，可高频调用（每次短链创建成功后调用）。
   * 真实额度在 `syncQuotaFromBackend`（一批转存结束后）与线上对齐。
   */
  const deductQuotaLocally = (count: number) => {
    if (count <= 0) {
      return;
    }
    setQuotaState((current) => ({ ...current, usedLinks: current.usedLinks + count }));
  };

  /**
   * 从后台重新拉取额度并覆盖本地 `quotaState`，用于一批转存结束后与线上同步。
   *
   * 失败时静默（保留本地乐观值），避免打扰用户；调用方负责 toast 反馈。
   */
  const syncQuotaFromBackend = async () => {
    const key = apiKey.trim();
    if (!key) {
      return;
    }
    try {
      const quota = await loadBackendQuota(key);
      setQuotaState({
        maxLinks: quota.maxLinks,
        usedLinks: quota.usedLinks,
        shortlinkAccessStatus: quota.shortlinkAccessStatus,
      });
    } catch {
      // 静默：保留本地乐观扣减值，不阻断批次流程。
    }
  };

  // 启动时若本地已保存 API Key（且检测通过过），自动重新检测以恢复连接。
  const autoDetectApiKeyRef = useRef(false);
  useEffect(() => {
    if (autoDetectApiKeyRef.current) {
      return;
    }
    autoDetectApiKeyRef.current = true;
    const savedKey = loadStoredApiKey().trim();
    if (!savedKey || !isTauriRuntime()) {
      return;
    }
    void detectApiKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    apiKey,
    apiConnectionStatus,
    apiError,
    quotaState,
    ydisksAccounts,
    domainOptions,
    shortlinkOptions,
    detectApiKey,
    setApiKeyDraft,
    clearApiKeyImmediately,
    deductQuotaLocally,
    syncQuotaFromBackend,
  };
}
