//! 设置页：后台连接状态 / 网盘账号管理 / 显示与日志。
//!
//! `ProviderAccountsPanel` 与 `ProviderCard` 为设置页内部子组件，仅在此使用。

import { useMemo, useState } from 'react';
import { Archive, ShieldCheck, Trash2 } from 'lucide-react';

import { minimumTransferIntervalSeconds, providerKeys, providerLabels } from '../lib/constants';
import { isAwaitingProviderLogin, remainingLinksOf } from '../lib/guards';
import type { ProviderAccount, ProviderKey } from '../types';
import type { QuotaState, ThemeMode, TransferIntervalSettings } from '../lib/types';
import { Callout, Metric, SectionTitle, StatusPill, ThemeModeControl } from '../components/ui';

/** 设置页：后台连接状态 / 网盘账号管理（内含 `ProviderAccountsPanel` 与 `ProviderCard`）/ 显示与日志。 */
export function SettingsPage({
  apiError,
  apiStatusLabel,
  apiStatusTitle,
  apiStatusTone,
  connectedAccountCount,
  providers,
  quota,
  themeMode,
  transferIntervals,
  onClearApiKey,
  onDetectApiKey,
  onProviderAdd,
  onProviderCheck,
  onProviderClear,
  onProviderDelete,
  onProviderCookiePaste,
  onProviderLogin,
  onThemeModeChange,
  onTransferIntervalChange,
  onOpenLogDir,
}: {
  apiError: string;
  apiStatusLabel: string;
  apiStatusTitle?: string;
  apiStatusTone: 'success' | 'warning' | 'danger' | 'info';
  connectedAccountCount: number;
  providers: ProviderAccount[];
  quota: QuotaState;
  themeMode: ThemeMode;
  transferIntervals: TransferIntervalSettings;
  onClearApiKey: () => void;
  onDetectApiKey: () => void;
  onProviderAdd: (provider: ProviderKey, displayName: string) => void;
  onProviderCheck: (accountId: string) => void;
  onProviderClear: (accountId: string) => void;
  onProviderDelete: (accountId: string) => void;
  onProviderCookiePaste: (accountId: string) => void;
  onProviderLogin: (accountId: string) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onTransferIntervalChange: (provider: ProviderKey, seconds: number) => void;
  onOpenLogDir: () => void;
}) {
  return (
    <div className="stack">
      <SectionTitle title="设置" />
      <div className="settings-layout">
        <section className="settings-panel">
          <div className="settings-panel-head">
            <div>
              <span className="eyebrow">风控</span>
              <h3>转存频率</h3>
            </div>
          </div>
          <Callout tone="info" title="按平台限流">
            {`限制同一网盘平台两次转存请求的发起间隔。默认 4 秒，最低不能低于 ${minimumTransferIntervalSeconds} 秒。`}
          </Callout>
          <div className="form-grid three">
            {providerKeys.map((provider) => (
              <label className="field" key={provider}>
                <span>{providerLabels[provider]}间隔（秒）</span>
                <input
                  aria-label={`${providerLabels[provider]}转存间隔`}
                  min={minimumTransferIntervalSeconds}
                  step="1"
                  type="number"
                  value={transferIntervals[provider]}
                  onChange={(event) => onTransferIntervalChange(provider, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-head">
            <div>
              <span className="eyebrow">后台</span>
              <h3>连接状态</h3>
            </div>
            <StatusPill tone={apiStatusTone} label={apiStatusLabel} title={apiStatusTitle} />
          </div>
          <div className="metric-grid compact-metrics">
            <Metric label="短链上限" value={String(quota.maxLinks)} />
            <Metric label="已用短链" value={String(quota.usedLinks)} />
            <Metric label="剩余额度" value={String(remainingLinksOf(quota))} tone="good" />
            <Metric label="网盘账号" value={String(connectedAccountCount)} tone="info" />
          </div>
          {apiError ? (
            <Callout tone="danger" title="连接失败">
              {apiError}
            </Callout>
          ) : null}
          <div className="action-row">
            <button className="primary-button" type="button" onClick={onDetectApiKey}>
              <ShieldCheck size={18} />
              检测连接
            </button>
            <button className="ghost-button" type="button" onClick={onClearApiKey}>
              <Trash2 size={18} />
              清除密钥
            </button>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-head">
            <div>
              <span className="eyebrow">网盘</span>
              <h3>账号管理</h3>
            </div>
          </div>
          <ProviderAccountsPanel
            providers={providers}
            onAdd={onProviderAdd}
            onCheck={onProviderCheck}
            onClear={onProviderClear}
            onDelete={onProviderDelete}
            onPasteCookie={onProviderCookiePaste}
            onLogin={onProviderLogin}
          />
        </section>

        <section className="settings-panel">
          <div className="settings-panel-head">
            <div>
              <span className="eyebrow">本地</span>
              <h3>显示与日志</h3>
            </div>
          </div>
          <div className="settings-local-grid">
            <ThemeModeControl value={themeMode} onChange={onThemeModeChange} />
          </div>
          <div className="action-row">
            <button className="ghost-button" type="button" onClick={onOpenLogDir}>
              <Archive size={18} />
              打开日志目录
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** 网盘账号管理面板：按平台分组列出账号，支持新增。 */
function ProviderAccountsPanel({
  providers,
  onAdd,
  onCheck,
  onClear,
  onDelete,
  onPasteCookie,
  onLogin,
}: {
  providers: ProviderAccount[];
  onAdd: (provider: ProviderKey, displayName: string) => void;
  onCheck: (accountId: string) => void;
  onClear: (accountId: string) => void;
  onDelete: (accountId: string) => void;
  onPasteCookie: (accountId: string) => void;
  onLogin: (accountId: string) => void;
}) {
  const [addingProvider, setAddingProvider] = useState<ProviderKey | null>(null);
  const [accountDraftName, setAccountDraftName] = useState('');
  const groupedProviders = useMemo(
    () => providerKeys.map((provider) => ({
      provider,
      name: providerLabels[provider],
      accounts: providers.filter((account) => account.provider === provider),
    })),
    [providers],
  );
  const openAddForm = (provider: ProviderKey) => {
    const sameProviderCount = providers.filter((account) => account.provider === provider).length;
    setAddingProvider(provider);
    setAccountDraftName(`${providerLabels[provider]}账号 ${sameProviderCount + 1}`);
  };
  const closeAddForm = () => {
    setAddingProvider(null);
    setAccountDraftName('');
  };
  const submitAddForm = (provider: ProviderKey) => {
    const displayName = accountDraftName.trim();
    if (!displayName) {
      return;
    }
    onAdd(provider, displayName);
    closeAddForm();
  };

  return (
    <div className="provider-groups">
      {groupedProviders.map((group) => (
        <section className="provider-group" key={group.provider}>
          <div className="provider-group-head">
            <div>
              <span className="eyebrow">{group.name}</span>
              <h3>{group.accounts.length} 个账号</h3>
            </div>
            <button className="ghost-button compact" type="button" onClick={() => openAddForm(group.provider)}>添加账号</button>
          </div>
          {addingProvider === group.provider ? (
            <div className="provider-add-form">
              <label className="field provider-add-field">
                <span>账号备注</span>
                <input
                  autoFocus
                  value={accountDraftName}
                  onChange={(event) => setAccountDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      submitAddForm(group.provider);
                    }
                    if (event.key === 'Escape') {
                      closeAddForm();
                    }
                  }}
                />
              </label>
              <div className="provider-add-actions">
                <button className="primary-button compact" type="button" disabled={!accountDraftName.trim()} onClick={() => submitAddForm(group.provider)}>保存</button>
                <button className="ghost-button compact" type="button" onClick={closeAddForm}>取消</button>
              </div>
            </div>
          ) : null}
          <div className="provider-grid">
            {group.accounts.length > 0 ? (
              group.accounts.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onCheck={() => onCheck(provider.id)}
                  onClear={() => onClear(provider.id)}
                  onDelete={() => onDelete(provider.id)}
                  onPasteCookie={() => onPasteCookie(provider.id)}
                  onLogin={() => onLogin(provider.id)}
                />
              ))
            ) : (
              <div className="provider-empty">暂无账号</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 单个网盘账号卡片：状态、说明与操作按钮（登录 / 检测 / 粘贴 Cookie / 清理 / 删除）。 */
function ProviderCard({
  provider,
  onCheck,
  onClear,
  onDelete,
  onPasteCookie,
  onLogin,
}: {
  provider: ProviderAccount;
  onCheck: () => void;
  onClear: () => void;
  onDelete: () => void;
  onPasteCookie: () => void;
  onLogin: () => void;
}) {
  const missingCredential = !provider.hasCredential;
  const effectiveStatus = provider.status === 'manual_required' ? 'manual_required' : missingCredential ? 'expired' : provider.status;
  const tone = effectiveStatus === 'connected' ? 'success' : effectiveStatus === 'expired' ? 'danger' : 'warning';
  const usesAutoLogin = true;
  const usesCookiePaste = provider.provider !== 'xunlei';
  const awaitingOfficialLogin = usesAutoLogin && isAwaitingProviderLogin(provider);
  const primaryActionLabel = effectiveStatus === 'connected'
    ? '检测'
    : provider.provider === 'xunlei'
      ? '登录'
      : awaitingOfficialLogin
        ? '重新打开'
        : '登录';
  const primaryAction = effectiveStatus === 'connected'
    ? onCheck
    : onLogin;
  const statusLabel = effectiveStatus === 'connected' ? '已登录' : effectiveStatus === 'expired' ? '登录过期' : '需要处理';
  const description = provider.pendingReason ?? (missingCredential ? '缺少登录态' : `${provider.purpose} · 最近检测：${provider.lastChecked}`);
  return (
    <div className="provider-card">
      <div className="provider-head">
        <div className={`provider-logo ${provider.provider}`}>{provider.platformName.slice(0, 1)}</div>
        <div>
          <h3>{provider.displayName}</h3>
          <span>{provider.loginName}</span>
        </div>
      </div>
      <StatusPill tone={tone} label={statusLabel} />
      <p>{description}</p>
      <div className="provider-actions">
        <button className="ghost-button compact" type="button" onClick={primaryAction}>
          {primaryActionLabel}
        </button>
        {usesCookiePaste ? (
          <button className="ghost-button compact" type="button" onClick={onPasteCookie}>
            {effectiveStatus === 'connected' ? '更新 Cookie' : '粘贴 Cookie'}
          </button>
        ) : null}
        {awaitingOfficialLogin && provider.provider === 'xunlei' ? (
          <button className="ghost-button compact" type="button" onClick={onLogin}>重新登录</button>
        ) : null}
        <button className="ghost-button compact" type="button" onClick={onClear}>清理会话</button>
        <button className="ghost-button compact danger" type="button" onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}
