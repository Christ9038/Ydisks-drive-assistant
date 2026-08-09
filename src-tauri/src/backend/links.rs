//! 原始链接与短链创建。

use serde_json::Value;

use crate::backend::client::post_backend_json;
use crate::error::{backend_error, BackendClientError};
use crate::types::{
    BackendCreationResult, BackendShortLinkResult, BackendShortLinkTarget,
    OriginalLinkCreatePayload, ShortLinkCreatePayload,
};

/// 构造原始链接创建 payload：标题与分享链接去首尾空白，`remark` 留空。
pub fn build_original_link_payload(title: &str, share_url: &str) -> OriginalLinkCreatePayload {
    OriginalLinkCreatePayload {
        name: title.trim().to_string(),
        original_url: share_url.trim().to_string(),
        remark: None,
    }
}

/// 依据短链目标列表构造逐个短链创建 payload，保持目标顺序；
/// 固定使用 `INHERIT` 继承原始链接的扫码/提取码模式。
pub fn build_short_link_payloads(
    title: &str,
    original_link_id: &str,
    targets: &[BackendShortLinkTarget],
) -> Vec<ShortLinkCreatePayload> {
    targets
        .iter()
        .map(|target| ShortLinkCreatePayload {
            account_id: target.account_id.clone(),
            channel_id: target.channel_id.clone(),
            original_link_id: original_link_id.to_string(),
            name: title.trim().to_string(),
            remark: None,
            short_domain: target.domain.clone(),
            expire_at: None,
            pc_qr_mode: "INHERIT".to_string(),
            extraction_mode: "INHERIT".to_string(),
            extraction_code: None,
            extraction_hint: None,
        })
        .collect()
}

/// 串行调用后台：先创建原始链接；若选择了渠道，再按目标渠道逐个创建短链。
pub async fn create_backend_links(
    api_key: &str,
    account_id: &str,
    title: &str,
    share_url: &str,
    targets: &[BackendShortLinkTarget],
) -> Result<BackendCreationResult, BackendClientError> {
    if api_key.trim().is_empty() {
        return Err(backend_error("auth", 1001, "请先填写 API Key"));
    }
    if account_id.trim().is_empty() {
        return Err(backend_error("original_link", -3, "缺少 Ydisks 后台账号"));
    }

    let original_payload = build_original_link_payload(title, share_url);
    let original_data = post_backend_json(
        api_key,
        &format!("/api/v1/assets/accounts/{account_id}/original-links"),
        &original_payload,
        "original_link",
    )
    .await?;
    let original_link_id = original_data
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| backend_error("original_link", -4, "后台未返回原始链接结果"))?
        .to_string();

    if targets.is_empty() {
        return Ok(BackendCreationResult {
            original_link_id,
            short_links: Vec::new(),
        });
    }

    let mut short_links = Vec::with_capacity(targets.len());
    for (index, payload) in build_short_link_payloads(title, &original_link_id, targets)
        .into_iter()
        .enumerate()
    {
        let data =
            post_backend_json(api_key, "/api/v1/assets/links", &payload, "short_link").await?;
        let short_url = data
            .get("short_url")
            .and_then(Value::as_str)
            .ok_or_else(|| backend_error("short_link", -4, "后台未返回短链 URL"))?
            .to_string();
        short_links.push(BackendShortLinkResult {
            channel_id: payload.channel_id,
            channel_name: targets[index].channel_name.clone(),
            domain: payload.short_domain,
            short_url,
        });
    }

    Ok(BackendCreationResult {
        original_link_id,
        short_links,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::OriginalLinkCreatePayload;

    fn block_on_test<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Runtime::new()
            .expect("test tokio runtime should start")
            .block_on(future)
    }

    #[test]
    fn build_original_link_payload_should_match_swagger_contract() {
        let payload =
            build_original_link_payload("  短剧素材包 05  ", " https://pan.quark.cn/s/new-share ");

        assert_eq!(
            OriginalLinkCreatePayload {
                name: "短剧素材包 05".to_string(),
                original_url: "https://pan.quark.cn/s/new-share".to_string(),
                remark: None,
            },
            payload,
        );
    }

    #[test]
    fn build_short_link_payloads_should_preserve_target_order() {
        let targets = vec![
            BackendShortLinkTarget {
                account_id: "account-1".to_string(),
                channel_id: "channel-1".to_string(),
                channel_name: "小红书".to_string(),
                domain: "t.ydisks.cn".to_string(),
            },
            BackendShortLinkTarget {
                account_id: "account-1".to_string(),
                channel_id: "channel-2".to_string(),
                channel_name: "抖音".to_string(),
                domain: "go.ydisks.cn".to_string(),
            },
        ];

        let payloads = build_short_link_payloads("课程资料", "original-1", &targets);

        assert_eq!(2, payloads.len());
        assert_eq!("channel-1", payloads[0].channel_id);
        assert_eq!("channel-2", payloads[1].channel_id);
        assert_eq!("account-1", payloads[0].account_id);
        assert_eq!("original-1", payloads[0].original_link_id);
        assert_eq!("课程资料", payloads[0].name);
        assert_eq!("t.ydisks.cn", payloads[0].short_domain);
        assert_eq!("INHERIT", payloads[0].pc_qr_mode);
        assert_eq!("INHERIT", payloads[0].extraction_mode);
        assert_eq!(None, payloads[0].extraction_code);
    }

    #[test]
    fn create_backend_links_should_reject_missing_api_key() {
        let result = block_on_test(create_backend_links(
            "",
            "account-1",
            "标题",
            "https://pan.quark.cn/s/new",
            &[],
        ));

        assert_eq!(
            crate::error::BackendClientError {
                code: 1001,
                message: "请先填写 API Key".to_string(),
                stage: "auth".to_string(),
                details: std::collections::HashMap::new(),
            },
            result.expect_err("missing key should fail"),
        );
    }
}
