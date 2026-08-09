import {
  FileInput,
  History,
  KeyRound,
  ListChecks,
  Menu,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageKey, ProviderAccount, ProviderKey, ProviderStatus } from './types';
import {
  providerAccountsStorageKey,
  legacyDemoProviderAccountIds,
  providerLabels,
} from './lib/constants';
import {
  isProviderAccountUsable,
  isXunleiAuthorizationPendingMessage,
  isCredentialErrorMessage,
  isAwaitingProviderLogin,
  providerAccountLabel,
} from './lib/guards';
import { formatBackendError } from './lib/format';
import { createProviderAccount } from './lib/engine';
import {
  loadStoredProviderAccounts,
  saveStoredProviderAccounts,
} from './lib/storage';
import {
  isTauriRuntime,
  openProviderLogin,
  captureProviderLogin,
  checkProviderLogin,
  listProviderAccountsFromDb,
  upsertProviderAccountToDb,
  deleteProviderAccountFromDb,
  importLegacyAccountsToDb,
  openLogDir as openLogDirBridge,
  downloadHistoryCsv,
} from './lib/bridge';
import {
  ConfirmDialog,
  CookiePasteModal,
  XunleiQrModal,
  XunleiPasswordModal,
} from './components/modals';
import { TasksPage } from './pages/TasksPage';
import { StatusPage } from './pages/StatusPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { useThemeMode } from './hooks/useThemeMode';
import { useToast } from './hooks/useToast';
import { useCookieModal } from './hooks/useCookieModal';
import { useApiConnection, type ApiConnectionStatus } from './hooks/useApiConnection';
import { useXunleiLogin } from './hooks/useXunleiLogin';
import { useBatchEngine, type ConfirmState } from './hooks/useBatchEngine';
import type { ToastState } from './hooks/useToast';

// 重新导出供测试与外部消费的组件，保持 `../App` 公共 API 稳定。
export { SelectField, ThemeModeControl } from './components/ui';
export { ConfirmDialog } from './components/modals';
import type {
  RustQuarkLoginResult,
  RustProviderLoginEvent,
  HistoryRecord,
} from './lib/types';

const primaryPages: PageKey[] = ['tasks', 'status', 'history'];

const pageMeta: Record<PageKey, { label: string; eyebrow: string; icon: typeof KeyRound }> = {
  tasks: { label: '任务', eyebrow: '新建批量转存', icon: FileInput },
  status: { label: '状态', eyebrow: '执行监控', icon: ListChecks },
  history: { label: '历史记录', eyebrow: '批次记录', icon: History },
  settings: { label: '设置', eyebrow: '后台 / 网盘 / 本地', icon: Settings },
};

const apiConnectionLabels: Record<ApiConnectionStatus, string> = {
  idle: '待检测',
  checking: '检测中',
  connected: '已连接',
  failed: '未连接',
};

const apiConnectionTones: Record<ApiConnectionStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  idle: 'warning',
  checking: 'info',
  connected: 'success',
  failed: 'danger',
};

// Tauri 桥接层（invoke 包装 / 持久化 / 后台 API / 导出）已抽离至 src/lib/bridge.ts。

/**
 * 桌面助手入口：UI 负责展示与任务操作，后台资产和链接创建优先交给 Rust 侧。
 */
function App() {
  const [activePage, setActivePage] = useState<PageKey>('tasks');
  const [dedupeEnabled, setDedupeEnabled] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { themeMode, setThemeMode } = useThemeMode();
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccount[]>(loadStoredProviderAccounts);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const { toast, setToast } = useToast();
  const {
    apiKey,
    apiConnectionStatus,
    apiError,
    quotaState,
    ydisksAccounts,
    domainOptions,
    shortlinkOptions,
    detectApiKey: handleDetectApiKey,
    setApiKeyDraft,
    clearApiKeyImmediately,
    deductQuotaLocally,
    syncQuotaFromBackend,
  } = useApiConnection(setToast);

  const hasApiKey = apiKey.trim().length > 0;
  const apiKeySaved = apiConnectionStatus === 'connected' && hasApiKey;
  const apiStatusLabel = hasApiKey ? apiConnectionLabels[apiConnectionStatus] : '未连接';
  const apiStatusTone = hasApiKey ? apiConnectionTones[apiConnectionStatus] : 'danger';
  const apiStatusTitle = apiConnectionStatus === 'failed' && apiError ? apiError : undefined;
  const currentMeta = pageMeta[activePage];
  const connectedAccountCount = providerAccounts.filter(isProviderAccountUsable).length;

  // 启动时从 SQLite 加载账号；若 DB 为空且 localStorage 仍有旧数据则一次性迁移。
  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const dbAccounts = await listProviderAccountsFromDb();
        if (cancelled) {
          return;
        }
        if (dbAccounts.length === 0) {
          const legacy = loadStoredProviderAccounts();
          if (legacy.length > 0) {
            await importLegacyAccountsToDb(legacy);
            window.localStorage.removeItem(providerAccountsStorageKey);
            const migrated = await listProviderAccountsFromDb();
            if (!cancelled) {
              setProviderAccounts(migrated);
            }
            return;
          }
        }
        setProviderAccounts(dbAccounts);
      } catch (error) {
        console.warn('加载网盘账号失败', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 账号变更时同步到 SQLite（浏览器开发环境仍写 localStorage）。
  const knownAccountIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const realAccounts = providerAccounts.filter((account) => !legacyDemoProviderAccountIds.has(account.id));
    if (realAccounts.length !== providerAccounts.length) {
      setProviderAccounts(realAccounts);
      return;
    }
    if (!isTauriRuntime()) {
      saveStoredProviderAccounts(realAccounts);
      return;
    }
    const currentIds = new Set(realAccounts.map((account) => account.id));
    void (async () => {
      try {
        for (const account of realAccounts) {
          await upsertProviderAccountToDb(account);
        }
        for (const previousId of knownAccountIdsRef.current) {
          if (!currentIds.has(previousId)) {
            await deleteProviderAccountFromDb(previousId);
          }
        }
        knownAccountIdsRef.current = currentIds;
      } catch (error) {
        console.warn('同步网盘账号失败', error);
      }
    })();
  }, [providerAccounts]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }

    let unlisten: (() => void) | undefined;
    void listen<RustProviderLoginEvent>('provider-login-complete', (event) => {
      const { accountId, provider, result } = event.payload;
      setProviderAccounts((current) => current.map((account) => (
        account.id === accountId
          ? {
              ...account,
              cookie: result.cookie,
              status: 'connected',
              loginName: result.loginName || `${providerLabels[provider]}已登录账号`,
              pendingReason: undefined,
              lastChecked: '刚刚',
            }
          : account
      )));
      setToast({ message: `${providerLabels[provider]}账号已登录`, tone: 'success' });
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const selectPage = (pageKey: PageKey) => {
    setActivePage(pageKey);
    setSidebarOpen(false);
  };

  const requestConfirm = (state: ConfirmState) => {
    setConfirmState(state);
  };

  const updateProviderAccount = (accountId: string, updater: (account: ProviderAccount) => ProviderAccount) => {
    setProviderAccounts((current) => current.map((account) => account.id === accountId ? updater(account) : account));
  };

  const {
    batches,
    histories,
    createBatch,
    pauseBatch,
    continueBatch,
    retryBatch,
    retryQueueItem,
    cancelBatch,
  } = useBatchEngine({
    providerAccounts,
    apiKey,
    updateProviderAccount,
    setToast,
    requestConfirm,
    onBatchCreated: () => selectPage('status'),
    deductQuotaLocally,
    syncQuotaFromBackend,
  });

  const clearApiKey = () => {
    requestConfirm({
      title: '清除 API Key',
      message: '确认清除本地保存的 API Key？清除后需要重新填写并检测。',
      confirmLabel: '清除密钥',
      danger: true,
      onConfirm: clearApiKeyImmediately,
    });
  };

  const exportHistoryCsv = async (history: HistoryRecord) => {
    setToast({ message: '正在导出 CSV...', tone: 'info' });
    try {
      const exportableHistory = {
        ...history,
        items: history.items.map((item) => ({
          ...item,
          accountName: item.accountName ?? providerAccountLabel(providerAccounts, item.accountId),
        })),
      };
      const savedPath = await downloadHistoryCsv(exportableHistory);
      if (savedPath) {
        setToast({ message: `已导出到 ${savedPath}`, tone: 'success' });
      } else if (!isTauriRuntime()) {
        setToast({ message: 'CSV 已下载', tone: 'success' });
      } else {
        setToast({ message: '已取消导出', tone: 'info' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : formatBackendError(error);
      setToast({ message: `导出失败：${message}`, tone: 'danger' });
    }
  };

  const openLogDir = async () => {
    if (!isTauriRuntime()) {
      setToast({ message: '请在桌面端运行', tone: 'danger' });
      return;
    }
    try {
      const logDir = await openLogDirBridge();
      setToast({ message: `已打开日志目录：${logDir}`, tone: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : formatBackendError(error);
      setToast({ message: `打开日志目录失败：${message}`, tone: 'danger' });
    }
  };

  const {
    cookieModalAccount,
    cookieDraft,
    cookieError,
    cookieSaving,
    openCookieModal: handleProviderCookiePaste,
    closeCookieModal,
    resetCookieModal,
    isCookieModalOpenFor,
    setCookieDraft,
    submitCookieModal,
  } = useCookieModal(providerAccounts, updateProviderAccount);

  const {
    xunleiQrAccount,
    xunleiQr,
    xunleiQrError,
    xunleiQrLoading,
    openXunleiAuthorization,
    xunleiLoginAccount,
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
  } = useXunleiLogin(providerAccounts, updateProviderAccount, setToast);

  const handleProviderAdd = (provider: ProviderKey, displayName: string) => {
    const nextDisplayName = displayName.trim();
    if (!nextDisplayName) {
      return;
    }
    const pendingReason = provider === 'xunlei'
      ? '请填写迅雷账号和密码登录。'
      : `请在${providerLabels[provider]}官方窗口完成登录，登录成功后会自动保存。`;
    const account = {
      ...createProviderAccount(provider, nextDisplayName),
      status: 'manual_required' as ProviderStatus,
      pendingReason,
      lastChecked: '刚刚',
    };
    setProviderAccounts((current) => [...current, account]);
    if (provider === 'xunlei') {
      openXunleiPasswordLogin(account);
      return;
    }
    void openProviderLogin(account).catch((error) => {
      updateProviderAccount(account.id, (current) => ({
        ...current,
        pendingReason: formatBackendError(error),
        lastChecked: '刚刚',
      }));
    });
  };

  const handleProviderDelete = (accountId: string) => {
    const account = providerAccounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }
    if (isCookieModalOpenFor(accountId)) {
      resetCookieModal();
    }
    setProviderAccounts((current) => current.filter((item) => item.id !== accountId));
  };

  const handleProviderLogin = async (accountId: string) => {
    const account = providerAccounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }

    updateProviderAccount(accountId, (current) => ({
      ...current,
      status: 'manual_required',
      pendingReason: current.provider === 'xunlei'
        ? '请填写迅雷账号和密码登录。'
        : `请在${providerLabels[current.provider]}官方窗口完成登录，登录成功后会自动保存。`,
      lastChecked: '刚刚',
    }));

    try {
      if (account.provider === 'xunlei') {
        openXunleiPasswordLogin(account);
      } else {
        await openProviderLogin(account);
      }
    } catch (error) {
      updateProviderAccount(accountId, (current) => ({
        ...current,
        status: 'manual_required',
        pendingReason: formatBackendError(error),
        lastChecked: '刚刚',
      }));
    }
  };

  const handleProviderCheck = async (accountId: string) => {
    const account = providerAccounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }

    try {
      const awaitingLogin = isAwaitingProviderLogin(account);
      let result: RustQuarkLoginResult;
      if (account.provider === 'xunlei' && awaitingLogin) {
        openXunleiPasswordLogin(account);
        updateProviderAccount(accountId, (current) => ({
          ...current,
          status: 'manual_required',
          pendingReason: '请填写迅雷账号和密码登录。',
          lastChecked: '刚刚',
        }));
        return;
      } else {
        result = account.cookie && !awaitingLogin
          ? await checkProviderLogin(account)
          : await captureProviderLogin(account);
      }
      updateProviderAccount(accountId, (current) => ({
        ...current,
        cookie: result.cookie,
        status: 'connected',
        loginName: result.loginName || '已登录账号',
        pendingReason: undefined,
        lastChecked: '刚刚',
      }));
      if (account.provider === 'xunlei') {
        resetXunleiQrModal();
      }
    } catch (error) {
      const message = formatBackendError(error);
      const isXunleiPending = account.provider === 'xunlei' && isXunleiAuthorizationPendingMessage(message);
      if (isXunleiPending) {
        clearXunleiLoginError();
        updateProviderAccount(accountId, (current) => ({
          ...current,
          status: 'manual_required',
          pendingReason: '请填写迅雷账号和密码登录。',
          lastChecked: '刚刚',
        }));
        return;
      }
      if (account.provider === 'xunlei') {
        setXunleiQrError(message);
      }
      updateProviderAccount(accountId, (current) => ({
        ...current,
        status: 'manual_required',
        pendingReason: message.includes('请先打开')
          ? `请先点击“重新登录”打开${providerLabels[current.provider]}官方窗口。`
          : message,
        lastChecked: '刚刚',
      }));
    }
  };

  const handleProviderClear = (accountId: string) => {
    if (isCookieModalOpenFor(accountId)) {
      resetCookieModal();
    }
    updateProviderAccount(accountId, (account) => ({
      ...account,
      cookie: undefined,
      status: 'expired',
      loginName: '未登录',
      pendingReason: '本地会话已清理',
      lastChecked: '刚刚',
    }));
  };


  const page = useMemo(() => {
    switch (activePage) {
      case 'tasks':
        return (
          <TasksPage
            accounts={providerAccounts}
            dedupeEnabled={dedupeEnabled}
            domainOptions={domainOptions}
            quota={quotaState}
            shortLinkTargets={shortlinkOptions}
            ydisksAccounts={ydisksAccounts}
            onCreateBatch={createBatch}
            onProviderCredentialError={(accountId, message) => updateProviderAccount(accountId, (current) => ({
              ...current,
              status: 'manual_required',
              pendingReason: message,
              lastChecked: '刚刚',
            }))}
            onToggleDedupe={() => setDedupeEnabled((value) => !value)}
          />
        );
      case 'status':
        return (
          <StatusPage
            accounts={providerAccounts}
            batches={batches}
            onCancel={cancelBatch}
            onContinue={continueBatch}
            onPause={pauseBatch}
            onRetry={retryBatch}
            onRetryItem={retryQueueItem}
          />
        );
      case 'history':
        return <HistoryPage accounts={providerAccounts} histories={histories} onExport={exportHistoryCsv} />;
      case 'settings':
        return (
          <SettingsPage
            apiError={apiError}
            apiStatusLabel={apiStatusLabel}
            apiStatusTitle={apiStatusTitle}
            apiStatusTone={apiStatusTone}
            connectedAccountCount={connectedAccountCount}
            providers={providerAccounts}
            quota={quotaState}
            themeMode={themeMode}
            onClearApiKey={clearApiKey}
            onDetectApiKey={handleDetectApiKey}
            onProviderAdd={handleProviderAdd}
            onProviderCheck={handleProviderCheck}
            onProviderClear={handleProviderClear}
            onProviderDelete={handleProviderDelete}
            onProviderCookiePaste={handleProviderCookiePaste}
            onProviderLogin={handleProviderLogin}
            onThemeModeChange={setThemeMode}
            onOpenLogDir={openLogDir}
          />
        );
      default:
        return null;
    }
  }, [activePage, apiError, apiKey, apiStatusLabel, apiStatusTitle, apiStatusTone, batches, connectedAccountCount, dedupeEnabled, domainOptions, histories, providerAccounts, quotaState, shortlinkOptions, themeMode, ydisksAccounts]);


  return (
    <div className={`app-shell ${sidebarOpen ? 'is-sidebar-open' : ''}`}>
      <button
        aria-label="关闭导航菜单"
        className="sidebar-scrim"
        type="button"
        onClick={() => setSidebarOpen(false)}
      />
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <img src="/icon.png" alt="Ydisks批量转存助手" />
          </div>
          <div>
            <div className="brand-title">Ydisks批量转存助手</div>
          </div>
          <button className="mobile-close-button" type="button" aria-label="关闭导航菜单" onClick={() => setSidebarOpen(false)}>
            <XCircle size={18} />
          </button>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {primaryPages.map((pageKey) => {
            const Icon = pageMeta[pageKey].icon;
            const selected = pageKey === activePage;
            return (
              <button
                key={pageKey}
                className={`nav-item ${selected ? 'is-active' : ''}`}
                type="button"
                onClick={() => selectPage(pageKey)}
              >
                <Icon size={19} />
                <span>{pageMeta[pageKey].label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            className={`settings-nav-button ${activePage === 'settings' ? 'is-active' : ''}`}
            type="button"
            onClick={() => selectPage('settings')}
          >
            <Settings size={18} />
            设置
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button className="mobile-menu-button" type="button" aria-label="打开导航菜单" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <div>
              <div className="eyebrow">{currentMeta.eyebrow}</div>
              <h1>{currentMeta.label}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-key">
              <KeyRound size={16} />
              <input
                aria-label="API Key"
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder="API Key"
                type="password"
                value={apiKey}
              />
              <button type="button" onClick={handleDetectApiKey} disabled={apiConnectionStatus === 'checking'}>
                {apiConnectionStatus === 'checking' ? '检测中' : '检测'}
              </button>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="清除 API Key"
              title="清除 API Key"
              onClick={clearApiKeyImmediately}
              disabled={!apiKey}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </header>

        <div className="content-grid content-grid-single">
          <section className="page-panel">{page}</section>
        </div>
      </main>
      {cookieModalAccount ? (
        <CookiePasteModal
          account={cookieModalAccount}
          error={cookieError}
          saving={cookieSaving}
          value={cookieDraft}
          onChange={setCookieDraft}
          onClose={closeCookieModal}
          onSubmit={submitCookieModal}
        />
      ) : null}
      {xunleiQrAccount ? (
        <XunleiQrModal
          account={xunleiQrAccount}
          error={xunleiQrError}
          loading={xunleiQrLoading}
          qr={xunleiQr}
          onClose={resetXunleiQrModal}
          onRefresh={() => void openXunleiAuthorization(xunleiQrAccount)}
          onSubmit={() => void handleProviderCheck(xunleiQrAccount.id)}
        />
      ) : null}
      {xunleiLoginAccount ? (
        <XunleiPasswordModal
          account={xunleiLoginAccount}
          creditKey={xunleiCreditKey}
          error={xunleiLoginError}
          password={xunleiPassword}
          rawReviewUrl={xunleiRawReviewUrl}
          reviewUrl={xunleiReviewUrl}
          saving={xunleiLoginSaving}
          username={xunleiUsername}
          onChangeCreditKey={setXunleiCreditKey}
          onChangePassword={setXunleiPassword}
          onChangeUsername={setXunleiUsername}
          onClose={closeXunleiPasswordLogin}
          onOpenReviewUrl={() => void openXunleiReviewUrl()}
          onSubmit={() => void submitXunleiPasswordLogin()}
        />
      ) : null}
      {toast ? (
        <div className={`toast toast-${toast.tone}`} role="status">
          {toast.message}
        </div>
      ) : null}
      {confirmState ? (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          onConfirm={() => {
            const handler = confirmState.onConfirm;
            setConfirmState(null);
            handler();
          }}
          onClose={() => setConfirmState(null)}
        />
      ) : null}
    </div>
  );
}

export default App;
