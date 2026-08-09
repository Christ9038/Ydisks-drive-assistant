//! 弹窗 / 覆盖层组件：确认对话框、Cookie 粘贴、迅雷扫码 / 密码登录、文件夹选择器。
//!
//! 这些组件通过 props 接收数据与回调；除 `FolderPickerModal` 内部维护目录浏览状态外，
//! 其余均为受控组件。依赖 `lib/bridge` 的目录浏览、`lib/format` 错误归一化、
//! `lib/guards` 凭证错误判定与 `./ui` 的提示 / 空状态组件。

import { useEffect, useState } from 'react';
import { Folder, FolderOpen, Loader2, ShieldCheck, XCircle } from 'lucide-react';

import { listProviderFolders } from '../lib/bridge';
import { defaultFolderRefs, providerLabels } from '../lib/constants';
import { formatBackendError } from '../lib/format';
import { isCredentialErrorMessage, isProviderAccountUsable } from '../lib/guards';
import type { ProviderAccount, ProviderKey } from '../types';
import type { RustProviderFolderItem, RustXunleiLoginQrResult } from '../lib/types';
import { Callout, EmptyState } from './ui';

/** 通用确认对话框：标题 + 消息 + 确认 / 取消，`danger` 时确认按钮高亮危险色。 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="confirm-modal-window" onClick={(event) => event.stopPropagation()}>
        <div className="execution-window-head">
          <div>
            <span className="eyebrow">请确认</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>
        <p className="confirm-modal-message">{message}</p>
        <div className="action-row">
          <button className={danger ? 'primary-button danger' : 'primary-button'} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** Cookie 粘贴弹窗：粘贴完整 Cookie 后保存并校验。 */
export function CookiePasteModal({
  account,
  error,
  saving,
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  account: ProviderAccount;
  error: string;
  saving: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="粘贴 Cookie">
      <div className="cookie-modal-window">
        <div className="execution-window-head">
          <div>
            <span className="eyebrow">{account.platformName}</span>
            <h2>{account.displayName}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" disabled={saving} onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>
        <label className="field">
          <span>Cookie</span>
          <textarea
            autoFocus
            className="cookie-modal-textarea"
            onChange={(event) => onChange(event.target.value)}
            placeholder="粘贴完整 Cookie"
            value={value}
          />
        </label>
        {error ? (
          <Callout tone="danger" title="验证失败">
            {error}
          </Callout>
        ) : null}
        <div className="action-row">
          <button className="primary-button" type="button" disabled={saving || !value.trim()} onClick={onSubmit}>
            {saving ? <Loader2 size={18} /> : <ShieldCheck size={18} />}
            {saving ? '保存中' : '保存 Cookie'}
          </button>
          <button className="ghost-button" type="button" disabled={saving} onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** 迅雷扫码授权弹窗：展示二维码 / 授权码，支持刷新与立即检查。 */
export function XunleiQrModal({
  account,
  error,
  loading,
  qr,
  onClose,
  onRefresh,
  onSubmit,
}: {
  account: ProviderAccount;
  error: string;
  loading: boolean;
  qr: RustXunleiLoginQrResult | null;
  onClose: () => void;
  onRefresh: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="迅雷扫码授权">
      <div className="xunlei-qr-window">
        <div className="folder-picker-head">
          <div>
            <span className="eyebrow">迅雷</span>
            <h2>{account.displayName}</h2>
          </div>
          <button className="ghost-button compact" type="button" onClick={onClose}>关闭</button>
        </div>

        {loading ? (
          <div className="xunlei-qr-placeholder">
            <Loader2 size={22} />
            <span>正在生成授权二维码</span>
          </div>
        ) : null}

        {!loading && qr ? (
          <>
            <div className="xunlei-qr-code" dangerouslySetInnerHTML={{ __html: qr.qrcodeSvg }} />
            <div className="xunlei-qr-meta">
              <span>授权码</span>
              <strong>{qr.userCode || '-'}</strong>
            </div>
            <p className="modal-hint">使用手机迅雷扫码授权。授权成功后会自动保存，二维码约 {qr.expiresIn} 秒内有效。</p>
          </>
        ) : null}

        {error ? <Callout tone="danger" title="授权状态">{error}</Callout> : null}

        <div className="provider-add-actions">
          <button className="primary-button compact" type="button" disabled={!qr || loading} onClick={onSubmit}>立即检查</button>
          <button className="ghost-button compact" type="button" disabled={loading} onClick={onRefresh}>刷新二维码</button>
        </div>
      </div>
    </div>
  );
}

/** 迅雷账号密码登录弹窗：账号 / 密码 / 验证链接 / CreditKey，支持风控验证流程。 */
export function XunleiPasswordModal({
  account,
  creditKey,
  error,
  password,
  rawReviewUrl,
  reviewUrl,
  saving,
  username,
  onChangeCreditKey,
  onChangePassword,
  onChangeUsername,
  onClose,
  onOpenReviewUrl,
  onSubmit,
}: {
  account: ProviderAccount;
  creditKey: string;
  error: string;
  password: string;
  rawReviewUrl: string;
  reviewUrl: string;
  saving: boolean;
  username: string;
  onChangeCreditKey: (value: string) => void;
  onChangePassword: (value: string) => void;
  onChangeUsername: (value: string) => void;
  onClose: () => void;
  onOpenReviewUrl: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="迅雷账号登录">
      <div className="cookie-modal-window">
        <div className="folder-picker-head">
          <div>
            <span className="eyebrow">迅雷</span>
            <h2>{account.displayName}</h2>
          </div>
          <button className="ghost-button compact" type="button" disabled={saving} onClick={onClose}>关闭</button>
        </div>
        <div className="form-grid two">
          <label className="field">
            <span>账号</span>
            <input
              autoFocus
              disabled={saving}
              value={username}
              onChange={(event) => onChangeUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              disabled={saving}
              type="password"
              value={password}
              onChange={(event) => onChangePassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onSubmit();
                }
              }}
            />
          </label>
        </div>
        {reviewUrl ? (
          <div className="xunlei-review-panel">
            <button
              className="ghost-button compact"
              type="button"
              disabled={saving}
              onClick={onOpenReviewUrl}
            >
              打开验证页
            </button>
            <label className="field">
              <span>{reviewUrl.includes('deviceid=') ? '验证链接（含 deviceid）' : '验证链接缺少 deviceid'}</span>
              <input readOnly value={reviewUrl} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <label className="field">
              <span>CreditKey</span>
              <input
                disabled={saving}
                value={creditKey}
                onChange={(event) => onChangeCreditKey(event.target.value)}
              />
            </label>
            {rawReviewUrl && rawReviewUrl !== reviewUrl ? (
              <label className="field wide-field">
                <span>接口原始地址</span>
                <input readOnly value={rawReviewUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <Callout tone={reviewUrl ? 'warning' : 'danger'} title={reviewUrl ? '需要二次验证' : '登录失败'}>
            {error}
          </Callout>
        ) : null}
        <div className="provider-add-actions">
          <button className="primary-button compact" type="button" disabled={saving || !username.trim() || !password} onClick={onSubmit}>
            {saving ? '登录中' : reviewUrl ? '验证后继续登录' : '登录'}
          </button>
          <button className="ghost-button compact" type="button" disabled={saving} onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** 文件夹选择器弹窗：逐级浏览网盘子目录，带面包屑导航与凭证错误回传。 */
export function FolderPickerModal({
  account,
  initialFolderName,
  initialFolderRef,
  provider,
  onClose,
  onCredentialError,
  onSelect,
}: {
  account?: ProviderAccount;
  initialFolderName: string;
  initialFolderRef: string;
  provider: ProviderKey;
  onClose: () => void;
  onCredentialError: (message: string) => void;
  onSelect: (folder: { name: string; folderRef: string }) => void;
}) {
  const rootRef = defaultFolderRefs[provider];
  const initialCrumbs = initialFolderRef === rootRef
    ? [{ name: '根目录', folderRef: rootRef }]
    : [{ name: '根目录', folderRef: rootRef }, { name: initialFolderName || '已选目录', folderRef: initialFolderRef }];
  const [currentRef, setCurrentRef] = useState(initialFolderRef || rootRef);
  const [crumbs, setCrumbs] = useState(initialCrumbs);
  const [folders, setFolders] = useState<RustProviderFolderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentName = crumbs[crumbs.length - 1]?.name ?? '根目录';

  const loadFolders = async (folderRef: string) => {
    setLoading(true);
    setError('');
    try {
      const items = await listProviderFolders({ account, folderRef, provider });
      setFolders(items.filter((item) => item.isDir));
    } catch (loadError) {
      const message = formatBackendError(loadError);
      setFolders([]);
      setError(message);
      if (isCredentialErrorMessage(message)) {
        onCredentialError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFolders(currentRef);
  }, [currentRef]);

  const enterFolder = (folder: RustProviderFolderItem) => {
    setCurrentRef(folder.folderRef);
    setCrumbs((current) => [...current, { name: folder.name, folderRef: folder.folderRef }]);
  };

  const jumpToCrumb = (index: number) => {
    const crumb = crumbs[index];
    if (!crumb) {
      return;
    }
    setCrumbs((current) => current.slice(0, index + 1));
    setCurrentRef(crumb.folderRef);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="选择目标文件夹">
      <div className="folder-picker-window">
        <div className="folder-picker-head">
          <div>
            <span className="eyebrow">{providerLabels[provider]}网盘</span>
            <h2>选择目标文件夹</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>

        <div className="folder-breadcrumb">
          {crumbs.map((crumb, index) => (
            <button
              className={index === crumbs.length - 1 ? 'is-current' : ''}
              key={`${crumb.folderRef}-${index}`}
              type="button"
              onClick={() => jumpToCrumb(index)}
            >
              {crumb.name}
            </button>
          ))}
        </div>

        <div className="folder-picker-body">
          {loading ? (
            <div className="folder-loading">
              <Loader2 size={18} />
              读取目录中
            </div>
          ) : error ? (
            <Callout tone="danger" title="读取失败">
              {error}
            </Callout>
          ) : folders.length > 0 ? (
            <div className="folder-list">
              {folders.map((folder) => (
                <button className="folder-row-button" key={folder.folderRef} type="button" onClick={() => enterFolder(folder)}>
                  <Folder size={18} />
                  <span>{folder.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="没有子文件夹" description="可以直接选择当前目录。" />
          )}
        </div>

        <div className="folder-picker-footer">
          <div>
            <span>当前目录</span>
            <strong>{currentName}</strong>
          </div>
          <div className="action-row">
            <button className="ghost-button" type="button" onClick={onClose}>取消</button>
            <button className="primary-button" type="button" onClick={() => onSelect({ name: currentName, folderRef: currentRef })}>
              确认选择
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 目录选择字段：展示当前目录名，点击打开 `FolderPickerModal`；无可用账号时禁用。 */
export function DirectorySelectField({
  account,
  folderName,
  provider,
  wide,
  onOpen,
}: {
  account?: ProviderAccount;
  folderName: string;
  provider: ProviderKey;
  wide?: boolean;
  onOpen: () => void;
}) {
  const disabled = !account || !isProviderAccountUsable(account);
  return (
    <div className={`directory-field ${wide ? 'wide-field' : ''}`}>
      <span>目标文件夹</span>
      <button className="directory-select-button" type="button" disabled={disabled} onClick={onOpen}>
        <FolderOpen size={18} />
        <strong>{folderName || '根目录'}</strong>
        <em>{disabled ? `暂无可用${providerLabels[provider]}账号` : '选择目录'}</em>
      </button>
    </div>
  );
}
