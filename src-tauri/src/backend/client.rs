//! 后台 API HTTP 调用与 `{ code, message, data }` 信封解析。

use serde::Serialize;
use serde_json::Value;

use crate::config::{DEFAULT_CONSOLE_API_BASE, QUOTA_LIMITED_CODE};
use crate::error::{backend_error, BackendClientError};
use crate::http::client::run_http_request;

/// 后台响应信封。
#[derive(Debug, serde::Deserialize)]
pub struct ApiEnvelope {
    code: i32,
    message: String,
    data: Value,
}

/// 控制台 API 基地址，可由 `YDISKS_CONSOLE_API_BASE` 环境变量覆盖。
pub fn console_api_base() -> String {
    std::env::var("YDISKS_CONSOLE_API_BASE")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CONSOLE_API_BASE.to_string())
}

/// 校验后台信封：`code == 0` 返回 `data`，否则按 `stage` 构造错误；
/// 配额不足码会替换为更友好的中文提示。
fn parse_api_success(envelope: ApiEnvelope, stage: &str) -> Result<Value, BackendClientError> {
    if envelope.code == 0 {
        return Ok(envelope.data);
    }

    let message = if envelope.code == QUOTA_LIMITED_CODE {
        "短链额度不足，请补充额度后重试".to_string()
    } else {
        envelope.message
    };
    Err(backend_error(stage, envelope.code, message))
}

/// 发起后台 JSON 请求（默认 45s 超时）。
///
/// 序列化请求体、附带 `X-API-Key` 头并解析 `{ code, message, data }` 信封。
/// `api_key` 为空时立即返回 `auth` 阶段错误；`stage` 用于错误归类。
pub async fn run_backend_json_request<T: Serialize>(
    api_key: &str,
    method: &str,
    path: &str,
    body: Option<&T>,
    stage: &str,
) -> Result<Value, BackendClientError> {
    run_backend_json_request_with_timeout(api_key, method, path, body, stage, 45).await
}

/// 发起后台 JSON 请求，可指定 `max_time`（秒）超时；其余行为同 [`run_backend_json_request`]。
pub async fn run_backend_json_request_with_timeout<T: Serialize>(
    api_key: &str,
    method: &str,
    path: &str,
    body: Option<&T>,
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    if api_key.trim().is_empty() {
        return Err(backend_error("auth", 1001, "请先填写 API Key"));
    }

    let url = format!("{}{}", console_api_base(), path);
    let body = body
        .map(|payload| {
            serde_json::to_vec(payload)
                .map_err(|error| backend_error(stage, -5, format!("序列化后台请求失败：{error}")))
        })
        .transpose()?;
    let response = run_http_request(
        method,
        &url,
        &[
            "Accept: application/json".to_string(),
            "Content-Type: application/json".to_string(),
            format!("X-API-Key: {}", api_key.trim()),
        ],
        body,
        stage,
        max_time,
        "后台",
    )
    .await?;
    let envelope = serde_json::from_value::<ApiEnvelope>(response)
        .map_err(|error| backend_error(stage, -2, format!("解析后台响应失败：{error}")))?;

    parse_api_success(envelope, stage)
}

/// 后台 GET 请求的便捷封装，使用默认 45s 超时。
pub async fn get_backend_json(
    api_key: &str,
    path: &str,
    stage: &str,
) -> Result<Value, BackendClientError> {
    run_backend_json_request(api_key, "GET", path, None::<&serde_json::Value>, stage).await
}

/// 后台 GET 请求的便捷封装，可指定 `max_time`（秒）超时。
pub async fn get_backend_json_with_timeout(
    api_key: &str,
    path: &str,
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    run_backend_json_request_with_timeout(
        api_key,
        "GET",
        path,
        None::<&serde_json::Value>,
        stage,
        max_time,
    )
    .await
}

/// 后台 POST 请求的便捷封装，使用默认 45s 超时；`body` 会被 JSON 序列化后发送。
pub async fn post_backend_json(
    api_key: &str,
    path: &str,
    body: &impl Serialize,
    stage: &str,
) -> Result<Value, BackendClientError> {
    run_backend_json_request(api_key, "POST", path, Some(body), stage).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_api_success_should_return_data_on_zero_code() {
        let envelope = ApiEnvelope {
            code: 0,
            message: "ok".to_string(),
            data: json!({"id": "x"}),
        };
        assert_eq!(
            json!({"id": "x"}),
            parse_api_success(envelope, "assets").unwrap()
        );
    }

    #[test]
    fn parse_api_success_should_return_null_data_when_code_zero() {
        // code 0 with null data still succeeds (Ok(Null)); this covers the
        // "missing/null data" path the envelope contract allows at parse time.
        let envelope = ApiEnvelope {
            code: 0,
            message: "ok".to_string(),
            data: Value::Null,
        };
        assert_eq!(Value::Null, parse_api_success(envelope, "assets").unwrap());
    }

    #[test]
    fn parse_api_success_should_surface_message_on_nonzero_code() {
        let envelope = ApiEnvelope {
            code: 1,
            message: "fail".to_string(),
            data: Value::Null,
        };
        assert_eq!(
            backend_error("assets", 1, "fail"),
            parse_api_success(envelope, "assets").unwrap_err(),
        );
    }

    #[test]
    fn parse_api_success_should_use_quota_friendly_message_for_quota_code() {
        let envelope = ApiEnvelope {
            code: QUOTA_LIMITED_CODE,
            message: "原始后台消息".to_string(),
            data: Value::Null,
        };
        let error = parse_api_success(envelope, "short_link").unwrap_err();
        assert_eq!(QUOTA_LIMITED_CODE, error.code);
        assert_eq!("short_link", error.stage);
        assert_eq!(
            "短链额度不足，请补充额度后重试", error.message,
            "quota code is replaced with a friendlier message",
        );
    }

    #[test]
    fn api_envelope_should_require_data_field_when_deserializing() {
        // The envelope struct declares `data: Value` (required, not Option), so a
        // payload missing `data` fails to deserialize — matching the impl contract.
        let result = serde_json::from_value::<ApiEnvelope>(json!({"code": 0, "message": "ok"}));
        assert!(
            result.is_err(),
            "missing `data` field must fail deserialization"
        );
    }
}
