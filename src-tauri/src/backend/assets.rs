//! 后台资产拉取：配额、推广账号、渠道、域名。

use serde_json::Value;

use crate::backend::client::{get_backend_json, get_backend_json_with_timeout};
use crate::error::BackendClientError;
use crate::http::client::{as_string, as_u32};
use crate::types::{
    BackendAccountOption, BackendAssetsSnapshot, BackendChannelOption, BackendDomainOption,
    BackendQuotaSummary,
};

/// 从后台响应 JSON 解析短链配额摘要（剩余数 = 上限 - 已用，下溢截断为 0）。
fn parse_quota(data: &Value) -> BackendQuotaSummary {
    let max_links = as_u32(data.get("max_links"));
    let used_links = as_u32(data.get("used_links"));
    BackendQuotaSummary {
        max_links,
        used_links,
        remaining_links: max_links.saturating_sub(used_links),
        shortlink_access_status: as_string(data.get("shortlink_access_status")),
    }
}

/// 解析推广账号列表：跳过 `id`/`name` 为空的项，空 `account_type_name` 归一为 `None`。
fn parse_accounts(data: &Value) -> Vec<BackendAccountOption> {
    data.get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = as_string(item.get("id"));
            let name = as_string(item.get("name"));
            let account_type_name = as_string(item.get("account_type_name"));
            let account_type_name = if account_type_name.is_empty() {
                None
            } else {
                Some(account_type_name)
            };
            (!id.is_empty() && !name.is_empty()).then_some(BackendAccountOption {
                id,
                name,
                account_type_name,
            })
        })
        .collect()
}

/// 解析渠道列表：跳过 `id`/`name` 为空的项。
fn parse_channels(data: &Value) -> Vec<BackendChannelOption> {
    data.get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = as_string(item.get("id"));
            let name = as_string(item.get("name"));
            (!id.is_empty() && !name.is_empty()).then_some(BackendChannelOption { id, name })
        })
        .collect()
}

/// 解析可用域名列表：跳过 `domain_name` 为空的项。
fn parse_domains(data: &Value) -> Vec<BackendDomainOption> {
    data.get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let domain_name = as_string(item.get("domain_name"));
            let status = as_string(item.get("status"));
            (!domain_name.is_empty()).then_some(BackendDomainOption {
                domain_name,
                status,
            })
        })
        .collect()
}

/// 一次性拉取后台资产快照：配额、推广账号、渠道、可用域名，合并为 [`BackendAssetsSnapshot`] 返回。
pub async fn fetch_backend_assets(
    api_key: &str,
) -> Result<BackendAssetsSnapshot, BackendClientError> {
    let quota = parse_quota(&get_backend_json(api_key, "/api/v1/assets/quotas", "quota").await?);
    let accounts = parse_accounts(
        &get_backend_json(
            api_key,
            "/api/v1/assets/accounts?page=1&page_size=100",
            "accounts",
        )
        .await?,
    );
    let channels = parse_channels(
        &get_backend_json(
            api_key,
            "/api/v1/assets/channels?page=1&page_size=200",
            "channels",
        )
        .await?,
    );
    let domains = parse_domains(
        &get_backend_json(api_key, "/api/v1/assets/domains/available", "domains").await?,
    );

    Ok(BackendAssetsSnapshot {
        quota,
        accounts,
        channels,
        domains,
    })
}

/// 单独拉取短链配额摘要（8s 超时），用于额度刷新等轻量轮询。
pub async fn fetch_backend_quota(api_key: &str) -> Result<BackendQuotaSummary, BackendClientError> {
    Ok(parse_quota(
        &get_backend_json_with_timeout(api_key, "/api/v1/assets/quotas", "quota", 8).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_backend_assets_should_match_swagger_response_shape() {
        let quota = parse_quota(&serde_json::json!({
            "max_links": 120,
            "used_links": 92,
            "shortlink_access_status": "NORMAL"
        }));
        let accounts = parse_accounts(&serde_json::json!({
            "items": [
                { "id": "account-1", "name": "夸克推广账号", "account_type_name": "夸克网盘" },
                { "id": "", "name": "无效账号" }
            ]
        }));
        let channels = parse_channels(&serde_json::json!({
            "items": [
                { "id": "channel-1", "name": "小红书" }
            ]
        }));
        let domains = parse_domains(&serde_json::json!({
            "items": [
                { "domain_name": "t.ydisks.cn", "status": "ACTIVE" }
            ]
        }));

        assert_eq!(28, quota.remaining_links);
        assert_eq!("NORMAL", quota.shortlink_access_status);
        assert_eq!(1, accounts.len());
        assert_eq!("夸克推广账号", accounts[0].name);
        assert_eq!(Some("夸克网盘".to_string()), accounts[0].account_type_name);
        assert_eq!(1, channels.len());
        assert_eq!("小红书", channels[0].name);
        assert_eq!(1, domains.len());
        assert_eq!("t.ydisks.cn", domains[0].domain_name);
    }
}
