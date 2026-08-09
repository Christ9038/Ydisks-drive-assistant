//! 表单字段组件：短链多渠道目标配置。
//!
//! 受控组件：渠道开关与域名选择通过回调上抛，无内部状态。

import type { ShortLinkTarget } from '../types';
import type { DomainOption } from '../lib/types';

/** 多渠道短链目标列表：逐渠道开关 + 域名选择，转存后批量创建短链。 */
export function ShortLinkTargets({
  domainOptions,
  onChangeDomain,
  targets,
  onToggle,
}: {
  domainOptions: DomainOption[];
  targets: ShortLinkTarget[];
  onChangeDomain: (targetId: string, domain: string) => void;
  onToggle: (targetId: string) => void;
}) {
  return (
    <div className="shortlink-targets">
      <div className="shortlink-targets-head">
        <div>
          <span className="eyebrow">多渠道短链</span>
          <h3>转存后批量创建短链</h3>
        </div>
      </div>
      {targets.length > 0 ? (
        <div className="shortlink-target-list">
          {targets.map((target) => (
            <div className={`shortlink-target ${target.enabled ? '' : 'is-disabled'}`} key={target.id}>
              <input id={`shortlink-target-${target.id}`} checked={target.enabled} onChange={() => onToggle(target.id)} type="checkbox" />
              <label className="shortlink-target-main" htmlFor={`shortlink-target-${target.id}`}>
                <strong>{target.channelName}</strong>
              </label>
              <label className="shortlink-domain-field">
                <span>短链域名</span>
                <select
                  aria-label={`${target.channelName}短链域名`}
                  disabled={!target.enabled || domainOptions.length === 0}
                  value={target.domain}
                  onChange={(event) => onChangeDomain(target.id, event.target.value)}
                >
                  {domainOptions.length > 0 ? (
                    domainOptions.map((domain) => (
                      <option key={domain.domainName} value={domain.domainName}>{domain.domainName}</option>
                    ))
                  ) : (
                    <option value="">暂无可用域名</option>
                  )}
                </select>
              </label>
            </div>
          ))}
        </div>
      ) : (
        <div className="provider-empty">暂无短链渠道</div>
      )}
    </div>
  );
}
