//! 任务页：新建批量转存任务。
//!
//! 三步向导：选择网盘账号与目标目录 / 导入资源（逐条 / 粘贴 / CSV）/ 可选配置短链渠道并提交。
//! 内部维护表单状态（平台、账号、目录、导入清单等），提交时通过 `onCreateBatch` 回传批次草稿。

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { FileInput, Play, Upload, Wand2 } from 'lucide-react';

import { parseImport } from '../lib/bridge';
import { defaultFolderRefs, providerKeys, providerLabels } from '../lib/constants';
import { remainingLinksOf, isProviderAccountUsable, providerOfAccountTypeName } from '../lib/guards';
import { normalizeShareUrl, parseCsvResources, parseTextResources } from '../lib/parsing';
import { buildImportItem } from '../lib/engine';
import type { ImportItem, ProviderAccount, ProviderKey, ShortLinkTarget } from '../types';
import type { BatchDraft, DomainOption, ParsedResource, QuotaState, YdisksAccountOption } from '../lib/types';
import { Callout, EmptyState, Field, Metric, SectionTitle, SelectField } from '../components/ui';
import { ImportTable } from '../components/tables';
import { DirectorySelectField, FolderPickerModal } from '../components/modals';
import { ShortLinkTargets } from '../components/fields';

/** 任务页：三步向导（选账号 → 导入资源 → 可选配短链执行）创建批量转存批次。 */
export function TasksPage({
  accounts,
  dedupeEnabled,
  domainOptions,
  quota,
  shortLinkTargets,
  ydisksAccounts,
  onCreateBatch,
  onProviderCredentialError,
  onToggleDedupe,
}: {
  accounts: ProviderAccount[];
  dedupeEnabled: boolean;
  domainOptions: DomainOption[];
  quota: QuotaState;
  shortLinkTargets: ShortLinkTarget[];
  ydisksAccounts: YdisksAccountOption[];
  onCreateBatch: (draft: BatchDraft) => void;
  onProviderCredentialError: (accountId: string, message: string) => void;
  onToggleDedupe: () => void;
}) {
  const [provider, setProvider] = useState<ProviderKey>('quark');
  const [providerAccountId, setProviderAccountId] = useState(() => accounts.find((account) => account.provider === 'quark' && isProviderAccountUsable(account))?.id ?? '');
  const [ydisksAccountId, setYdisksAccountId] = useState(ydisksAccounts[0]?.id ?? '');
  const [targetFolderRef, setTargetFolderRef] = useState(defaultFolderRefs.quark);
  const [targetFolderName, setTargetFolderName] = useState('根目录');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [targets, setTargets] = useState(shortLinkTargets);
  const [importMode, setImportMode] = useState<'single' | 'paste' | 'csv'>('single');
  const [singleTitle, setSingleTitle] = useState('');
  const [singleUrl, setSingleUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [resources, setResources] = useState<ImportItem[]>([]);
  const [filterCount, setFilterCount] = useState(0);

  const groupedProviders = providerKeys.map((providerKey) => {
    const providerAccounts = accounts.filter((account) => account.provider === providerKey);
    const connectedCount = providerAccounts.filter(isProviderAccountUsable).length;
    return {
      key: providerKey,
      label: `${providerLabels[providerKey]}网盘`,
      meta: connectedCount > 0 ? `${connectedCount} 个可用账号` : '需重新登录',
    };
  });

  const connectedProviderAccounts = useMemo(
    () => accounts.filter((account) => account.provider === provider && isProviderAccountUsable(account)),
    [accounts, provider],
  );
  const selectedProviderAccount = accounts.find((account) => account.id === providerAccountId);
  useEffect(() => {
    if (selectedProviderAccount?.provider === provider && isProviderAccountUsable(selectedProviderAccount)) {
      return;
    }
    setProviderAccountId(connectedProviderAccounts[0]?.id ?? '');
  }, [accounts, provider, providerAccountId, selectedProviderAccount, connectedProviderAccounts]);

  // Ydisks 后台账号按当前网盘平台筛选：只显示与所选网盘类型一致的推广账号。
  const providerYdisksAccounts = useMemo(
    () => ydisksAccounts.filter((account) => providerOfAccountTypeName(account.accountTypeName) === provider),
    [ydisksAccounts, provider],
  );

  useEffect(() => {
    setTargetFolderRef(defaultFolderRefs[provider]);
    setTargetFolderName('根目录');
  }, [provider, providerAccountId]);

  useEffect(() => {
    setTargets(shortLinkTargets);
  }, [shortLinkTargets]);

  // 切换网盘平台或后台账号列表变化时，确保选中的后台账号仍属于当前平台。
  useEffect(() => {
    setYdisksAccountId((current) => (providerYdisksAccounts.some((account) => account.id === current)
      ? current
      : providerYdisksAccounts[0]?.id ?? ''));
  }, [providerYdisksAccounts]);

  const availableDomainOptions = useMemo(() => {
    const activeDomains = domainOptions.filter((domain) => domain.status === 'ACTIVE');
    return activeDomains.length > 0 ? activeDomains : domainOptions;
  }, [domainOptions]);
  const defaultDomainName = availableDomainOptions[0]?.domainName ?? '';
  useEffect(() => {
    if (!defaultDomainName) {
      return;
    }
    const availableDomains = new Set(availableDomainOptions.map((domain) => domain.domainName));
    setTargets((current) => current.map((target) => (
      target.domain && availableDomains.has(target.domain)
        ? target
        : { ...target, domain: defaultDomainName }
    )));
  }, [availableDomainOptions, defaultDomainName]);

  const selectedYdisksAccount = providerYdisksAccounts.find((account) => account.id === ydisksAccountId) ?? providerYdisksAccounts[0];
  const targetsForAccount = targets.map((target) => ({
    ...target,
    ydisksAccountId: selectedYdisksAccount?.id ?? '',
    ydisksAccountName: selectedYdisksAccount?.name ?? '',
  }));
  const selectedTargets = targetsForAccount.filter((target) => target.enabled);
  const channelCount = selectedTargets.length;
  const validCount = resources.length;
  const requiredShortLinks = validCount * channelCount;
  const remainingLinks = remainingLinksOf(quota);
  const executable = channelCount === 0
    ? validCount
    : Math.min(validCount, Math.floor(remainingLinks / channelCount));
  const waiting = Math.max(validCount - executable, 0);
  const selectedTargetsReady = selectedTargets.every((target) => Boolean(target.domain));
  // 是否已连接 Ydisks 后台（有后台账号即等价于 API Key 检测通过）。未连接时走「仅转存」模式：
  // 后台账号选择与短链渠道禁用，转存成功即完成，不创建短链。
  const hasBackend = ydisksAccounts.length > 0;
  const canSubmit = validCount > 0
    && selectedTargetsReady
    && Boolean(selectedProviderAccount && isProviderAccountUsable(selectedProviderAccount));

  const appendResources = (parsedResources: ParsedResource[], filteredFromParser = 0) => {
    setResources((current) => [
      ...current,
      ...parsedResources.map((item, index) => buildImportItem(item, providerAccountId, index)),
    ]);
    setFilterCount((current) => current + filteredFromParser);
  };

  const addResources = (parsedResources: ParsedResource[]) => {
    let filtered = 0;
    const existingUrls = new Set(resources.map((item) => normalizeShareUrl(item.sourceUrl)));
    const nextItems: ImportItem[] = [];

    parsedResources.forEach((item, index) => {
      const normalizedUrl = normalizeShareUrl(item.sourceUrl);
      const duplicated = dedupeEnabled && (existingUrls.has(normalizedUrl) || nextItems.some((next) => normalizeShareUrl(next.sourceUrl) === normalizedUrl));
      if (item.provider === 'unknown' || item.provider !== provider || duplicated) {
        filtered += 1;
        return;
      }
      existingUrls.add(normalizedUrl);
      nextItems.push(buildImportItem(item, providerAccountId, index));
    });

    setResources((current) => [...current, ...nextItems]);
    setFilterCount((current) => current + filtered);
    return {
      added: nextItems.length,
      filtered,
    };
  };

  const addResourcesFromText = async (text: string, mode: 'text' | 'csv') => {
    try {
      const result = await parseImport({
        accountId: providerAccountId,
        dedupeEnabled,
        existingUrls: resources.map((item) => item.sourceUrl),
        mode,
        provider,
        text,
      });
      appendResources(result.accepted, result.filtered);
    } catch {
      const parsedResources = mode === 'csv' ? parseCsvResources(text) : parseTextResources(text);
      addResources(parsedResources);
    }
  };

  const selectProvider = (nextProvider: ProviderKey) => {
    const nextAccount = accounts.find((account) => account.provider === nextProvider && isProviderAccountUsable(account));
    setProvider(nextProvider);
    setProviderAccountId(nextAccount?.id ?? '');
    setTargetFolderRef(defaultFolderRefs[nextProvider]);
    setTargetFolderName('根目录');
    setResources([]);
    setFilterCount(0);
  };

  const handleCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    await addResourcesFromText(text, 'csv');
    event.target.value = '';
  };

  const submitBatch = () => {
    if (canSubmit && selectedProviderAccount) {
      onCreateBatch({
        provider,
        providerAccountId,
        providerAccountName: selectedProviderAccount.displayName,
        ydisksAccountId: selectedYdisksAccount?.id ?? '',
        ydisksAccountName: selectedYdisksAccount?.name ?? '',
        targetFolderRef,
        shortLinkTargets: selectedTargets,
        resources,
        executable,
        waitingQuota: waiting,
      });
      setResources([]);
      setFilterCount(0);
    }
  };

  return (
    <div className="stack task-flow">
      <SectionTitle title="新建批量任务" />
      <div className="task-wizard">
        {['账号', '资源', '执行'].map((label, index) => (
          <div className="task-wizard-step is-current" key={label}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>

      <section className="task-stage">
        <div className="task-stage-head">
          <span className="eyebrow">01</span>
          <h3>账号</h3>
        </div>
        <div className="platform-picker" aria-label="选择转存平台">
          {groupedProviders.map((item) => (
            <button className={`platform-option ${item.key === provider ? 'is-selected' : ''}`} key={item.key} type="button" onClick={() => selectProvider(item.key)}>
              <span className={`provider-logo ${item.key}`}>{providerLabels[item.key].slice(0, 1)}</span>
              <strong>{item.label}</strong>
              <em>{item.meta}</em>
            </button>
          ))}
        </div>
        <div className="form-grid two">
          <SelectField
            label="转存到网盘账号"
            onChange={setProviderAccountId}
            options={connectedProviderAccounts.length > 0
              ? connectedProviderAccounts.map((account) => ({ value: account.id, label: `${account.displayName} ${account.loginName}` }))
              : [{ value: '', label: '无可用账号' }]}
            value={providerAccountId}
          />
          <SelectField
            disabled={!hasBackend}
            label="Ydisks 后台账号"
            onChange={setYdisksAccountId}
            options={providerYdisksAccounts.length > 0
              ? providerYdisksAccounts.map((account) => ({ value: account.id, label: account.name }))
              : [{ value: '', label: hasBackend ? `暂无${providerLabels[provider]}后台账号` : '未连接后台（仅转存）' }]}
            value={ydisksAccountId}
          />
          <DirectorySelectField
            account={selectedProviderAccount}
            folderName={targetFolderName}
            provider={provider}
            wide
            onOpen={() => setFolderPickerOpen(true)}
          />
        </div>
        {!hasBackend ? (
          <Callout tone="info" title="仅转存模式">
            未连接 Ydisks 后台，本次将仅把资源转存到你的网盘，不创建短链。在右上角填写并检测 API Key 后，可一键为转存资源生成多渠道短链。
          </Callout>
        ) : null}
        <ShortLinkTargets
          disabled={!hasBackend}
          domainOptions={availableDomainOptions}
          targets={targetsForAccount}
          onChangeDomain={(targetId, domain) => setTargets((current) => current.map((target) => (
            target.id === targetId ? { ...target, domain } : target
          )))}
          onToggle={(targetId) => setTargets((current) => current.map((target) => target.id === targetId ? { ...target, enabled: !target.enabled } : target))}
        />
        {folderPickerOpen ? (
          <FolderPickerModal
            account={selectedProviderAccount}
            initialFolderName={targetFolderName}
            initialFolderRef={targetFolderRef}
            provider={provider}
            onClose={() => setFolderPickerOpen(false)}
            onCredentialError={(message) => {
              if (selectedProviderAccount) {
                onProviderCredentialError(selectedProviderAccount.id, message);
              }
            }}
            onSelect={(folder) => {
              setTargetFolderRef(folder.folderRef);
              setTargetFolderName(folder.name);
              setFolderPickerOpen(false);
            }}
          />
        ) : null}
      </section>

      <section className="task-stage">
        <div className="task-stage-head">
          <span className="eyebrow">02</span>
          <h3>资源</h3>
        </div>

        <div className="import-method-tabs" aria-label="选择导入方式">
          {[
            ['single', '逐条添加'],
            ['paste', '粘贴解析'],
            ['csv', 'CSV 导入'],
          ].map(([mode, label]) => (
            <button
              className={importMode === mode ? 'is-selected' : ''}
              key={mode}
              type="button"
              onClick={() => setImportMode(mode as 'single' | 'paste' | 'csv')}
            >
              {label}
            </button>
          ))}
        </div>

        {importMode === 'single' ? (
          <div className="import-method-panel">
            <div className="title-link-grid">
              <Field label="标题" value={singleTitle} onChange={setSingleTitle} />
              <Field label="网盘链接" value={singleUrl} onChange={setSingleUrl} />
            </div>
            <div className="action-row">
              <button className="primary-button" type="button" onClick={() => addResourcesFromText(`${singleTitle},${singleUrl}`, 'text')}>
                <FileInput size={18} />
                添加到清单
              </button>
              <label className="toggle-row">
                <input checked={dedupeEnabled} onChange={onToggleDedupe} type="checkbox" />
                <span>开启去重</span>
              </label>
            </div>
          </div>
        ) : null}

        {importMode === 'paste' ? (
          <div className="import-method-panel">
            <textarea
              aria-label="粘贴批量链接"
              onChange={(event) => setPasteText(event.target.value)}
              value={pasteText}
            />
            <div className="action-row">
              <button className="primary-button" type="button" onClick={() => addResourcesFromText(pasteText, 'text')}>
                <Wand2 size={18} />
                解析并加入清单
              </button>
              <label className="toggle-row">
                <input checked={dedupeEnabled} onChange={onToggleDedupe} type="checkbox" />
                <span>开启去重</span>
              </label>
            </div>
          </div>
        ) : null}

        {importMode === 'csv' ? (
          <div className="import-method-panel upload-panel">
            <Upload size={28} />
            <strong>选择 CSV 文件</strong>
            <span>字段：标题、网盘链接</span>
            <input accept=".csv,text/csv" aria-label="导入 CSV" type="file" onChange={handleCsvFile} />
          </div>
        ) : null}

        <div className="import-list-head">
          <h4>导入清单</h4>
          <div className="summary-inline">
            <span>已添加 {validCount}</span>
            <span>已过滤 {filterCount}</span>
          </div>
        </div>
        {resources.length > 0 ? (
          <ImportTable items={resources} onDelete={(itemId) => setResources((current) => current.filter((item) => item.id !== itemId))} />
        ) : (
          <EmptyState title="暂无资源" description="先通过逐条添加、粘贴解析或 CSV 导入加入同平台链接。" />
        )}
      </section>

      <section className="task-stage">
        <div className="task-stage-head">
          <span className="eyebrow">03</span>
          <h3>执行</h3>
        </div>
        <div className="quota-board">
          <Metric label="可执行资源" value={String(validCount)} />
          <Metric label="短链渠道" value={String(channelCount)} tone="info" />
          <Metric label="需创建短链" value={String(requiredShortLinks)} tone="info" />
          <Metric label="短链余量" value={String(remainingLinks)} tone="good" />
          <Metric label="本次处理" value={String(executable)} tone="good" />
          <Metric label="等待资源" value={String(waiting)} tone={waiting > 0 ? 'warning' : 'good'} />
        </div>
        {waiting > 0 ? (
          <Callout tone="warning" title="额度不足">
            有资源会等待短链额度。
          </Callout>
        ) : null}
        <div className="action-row">
          <button className="primary-button" type="button" disabled={!canSubmit} onClick={submitBatch}>
            <Play size={18} />
            创建任务并执行
          </button>
        </div>
      </section>
    </div>
  );
}
