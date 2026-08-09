//! HTTP 请求封装与共享工具实现。

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method};
use serde::Serialize;
use serde_json::Value;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::error::{backend_error, BackendClientError};

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static LOGIN_CAPTURE_IN_PROGRESS: OnceLock<Mutex<std::collections::HashSet<String>>> =
    OnceLock::new();

/// 全局共享的 HTTP 客户端（reqwest 单例）。
pub fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(Client::new)
}

/// 登录捕获进行中的标志集合（供 auth 模块使用）。
pub fn login_capture_in_progress() -> &'static Mutex<std::collections::HashSet<String>> {
    LOGIN_CAPTURE_IN_PROGRESS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

// === 通用 JSON 取值工具 ===

/// 把 JSON 值取作 `u32`，缺失或非数字时返回 0。
pub fn as_u32(value: Option<&Value>) -> u32 {
    value.and_then(Value::as_u64).unwrap_or_default() as u32
}

/// 把 JSON 值取作字符串，缺失或非字符串时返回空串。
pub fn as_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// 把任意 JSON 标量（数字/字符串/布尔）转为字符串，对象/数组返回空。
pub fn json_scalar_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

/// 字符串空值回退 trait。
pub trait EmptyStringFallback {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl EmptyStringFallback for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

/// Vec 空值回退 trait。
pub trait EmptyVecFallback<T> {
    fn if_empty_then(self, fallback: impl FnOnce() -> Vec<T>) -> Vec<T>;
}

impl<T> EmptyVecFallback<T> for Vec<T> {
    fn if_empty_then(self, fallback: impl FnOnce() -> Vec<T>) -> Vec<T> {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

/// 从错误响应 JSON 中提取可读消息。
pub fn json_error_message(data: &Value, fallback: &str) -> String {
    use crate::http::client::{as_string, json_scalar_to_string, EmptyStringFallback};
    let message = as_string(data.get("message"))
        .if_empty_then(|| as_string(data.get("msg")))
        .if_empty_then(|| as_string(data.get("error_description")))
        .if_empty_then(|| as_string(data.get("error")));
    if !message.is_empty() {
        return message;
    }
    let code = json_scalar_to_string(data.get("code"))
        .if_empty_then(|| json_scalar_to_string(data.get("errno")));
    if !code.is_empty() {
        return format!("{fallback}，接口返回 code={code}");
    }
    fallback.to_string()
}

// === URL / 编码工具 ===

/// RFC 3986 百分号编码：字母、数字与 `-_.~` 原样保留，其余字节转大写 `%XX`。
pub fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// 百分号解码：将 `%XX` 还原为原始字节，非法转义原样保留。
pub fn percent_decode(value: &str) -> String {
    /// 把单个十六进制字符字节解析为数值（0-15），非十六进制字符返回 `None`。
    fn hex_value(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                output.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

/// 在 `base` 后拼接查询串：键值均经 [`percent_encode`]，以 `&` 连接。
pub fn url_with_params(base: &str, params: &[(&str, String)]) -> String {
    let query = params
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{base}?{query}")
}

/// 从 URL 查询串中取指定 `key` 的首值，忽略 fragment 与空值；不存在时返回 `None`。
pub fn extract_query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split_once('?')?.1.split('#').next().unwrap_or_default();
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        if name == key && !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// 截取 URL 中 `marker` 之后、由字母数字与 `_-` 组成的首段 token（如登录重定向里的 stoken）。
pub fn take_url_token_after(url: &str, marker: &str) -> Option<String> {
    let start = url.find(marker)? + marker.len();
    let value = url[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect::<String>();
    (!value.is_empty()).then_some(value)
}

/// 把键值对按 `application/x-www-form-urlencoded` 拼接，键值均经 [`percent_encode`]，以 `&` 连接。
pub fn form_encode_pairs(pairs: &[(&str, String)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// 基于当前毫秒时间戳生成 4 位小写字母/数字短提取码（确定性，非密码学随机）。
pub fn generated_passcode() -> String {
    let alphabet = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut value = timestamp_ms() as usize;
    let mut out = String::new();
    for _ in 0..4 {
        out.push(alphabet[value % alphabet.len()] as char);
        value /= alphabet.len();
    }
    out
}

/// 追加单个 cookie 到 cookie 串：值为空时仅保留原串，原串为空时直接返回 `name=value`。
pub fn append_cookie(cookie: &str, name: &str, value: &str) -> String {
    if value.trim().is_empty() {
        return cookie.trim().to_string();
    }
    if cookie.trim().is_empty() {
        format!("{name}={value}")
    } else {
        format!("{}; {name}={value}", cookie.trim())
    }
}

/// 当前自 Unix 纪元起的毫秒时间戳，时钟异常时返回 0。
pub fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

// === HTTP 请求封装 ===

/// 将字符串解析为 [`Method`]，无效时按 `stage` 构造错误。
fn parse_http_method(method: &str, stage: &str) -> Result<Method, BackendClientError> {
    method
        .parse::<Method>()
        .map_err(|error| backend_error(stage, -3, format!("HTTP 方法无效：{error}")))
}

/// 将 `"Name: Value"` 字符串列表解析为 [`HeaderMap`]，缺冒号或非法名称/值按 `stage` 构造错误。
fn parse_http_headers(headers: &[String], stage: &str) -> Result<HeaderMap, BackendClientError> {
    let mut header_map = HeaderMap::new();
    for header in headers {
        let Some((name, value)) = header.split_once(':') else {
            return Err(backend_error(
                stage,
                -3,
                format!("HTTP Header 格式无效：{header}"),
            ));
        };
        let name = HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|error| backend_error(stage, -3, format!("HTTP Header 名称无效：{error}")))?;
        let value = HeaderValue::from_str(value.trim_start())
            .map_err(|error| backend_error(stage, -3, format!("HTTP Header 值无效：{error}")))?;
        header_map.append(name, value);
    }
    Ok(header_map)
}

/// 把响应正文解析为 JSON；解析失败时按 `stage` 构造错误，空正文与有内容时给出不同提示，`label` 用于错误文案。
fn parse_json_response_text(
    text: &str,
    stage: &str,
    label: &str,
) -> Result<Value, BackendClientError> {
    serde_json::from_str::<Value>(text).map_err(|error| {
        backend_error(
            stage,
            -2,
            if text.trim().is_empty() {
                format!("解析{label}响应失败：{error}")
            } else {
                format!("解析{label}响应失败：{error}；响应内容：{}", text.trim())
            },
        )
    })
}

/// 发送 HTTP 请求并把响应正文解析为 JSON 返回。
///
/// `max_time` 为秒级超时；`response_label` 用于错误文案。失败状态码且正文为空时直接返回
/// HTTP 错误，否则尝试按 JSON 解析正文（便于携带网盘返回的 `msg`/`code` 等结构）。
pub async fn run_http_request(
    method: &str,
    url: &str,
    headers: &[String],
    body: Option<Vec<u8>>,
    stage: &str,
    max_time: u32,
    response_label: &str,
) -> Result<Value, BackendClientError> {
    let mut request = http_client()
        .request(parse_http_method(method, stage)?, url)
        .headers(parse_http_headers(headers, stage)?)
        .timeout(Duration::from_secs(max_time as u64));
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| backend_error(stage, -7, format!("HTTP 请求失败：{error}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| backend_error(stage, -7, format!("读取 HTTP 响应失败：{error}")))?;

    if !status.is_success() && text.trim().is_empty() {
        return Err(backend_error(
            stage,
            status.as_u16() as i32,
            format!("HTTP 请求失败：{}", status.as_u16()),
        ));
    }

    parse_json_response_text(&text, stage, response_label)
}

/// 发送 HTTP 请求并返回原始正文文本。
///
/// 与 [`run_http_request`] 不同：响应不解析 JSON；非成功状态码一律返回错误，
/// 有正文时把正文片段拼入错误消息。
pub async fn run_http_text_request(
    method: &str,
    url: &str,
    headers: &[String],
    body: Option<Vec<u8>>,
    stage: &str,
    max_time: u32,
) -> Result<String, BackendClientError> {
    let mut request = http_client()
        .request(parse_http_method(method, stage)?, url)
        .headers(parse_http_headers(headers, stage)?)
        .timeout(Duration::from_secs(max_time as u64));
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| backend_error(stage, -7, format!("HTTP 请求失败：{error}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| backend_error(stage, -7, format!("读取 HTTP 响应失败：{error}")))?;

    if !status.is_success() {
        let message = if text.trim().is_empty() {
            format!("HTTP 请求失败：{}", status.as_u16())
        } else {
            format!(
                "HTTP 请求失败：{}；响应内容：{}",
                status.as_u16(),
                text.trim()
            )
        };
        return Err(backend_error(stage, status.as_u16() as i32, message));
    }

    Ok(text)
}

/// 序列化 `body` 为 JSON 后委托 [`run_http_request`] 发送并返回 JSON 响应。
pub async fn run_http_json_request<T: Serialize>(
    method: &str,
    url: &str,
    headers: &[String],
    body: Option<&T>,
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    let body = body
        .map(|payload| {
            serde_json::to_vec(payload)
                .map_err(|error| backend_error(stage, -5, format!("序列化请求失败：{error}")))
        })
        .transpose()?;
    run_http_request(method, url, headers, body, stage, max_time, "").await
}

/// 发送 JSON 请求并严格校验状态码：成功且空正文返回 `Value::Null`，非成功时用
/// [`json_error_message`] 从响应里提取可读消息拼入错误。
pub async fn run_http_json_request_strict<T: Serialize>(
    method: &str,
    url: &str,
    headers: &[String],
    body: Option<&T>,
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    let mut request = http_client()
        .request(parse_http_method(method, stage)?, url)
        .headers(parse_http_headers(headers, stage)?)
        .timeout(Duration::from_secs(max_time as u64));
    if let Some(payload) = body {
        let body = serde_json::to_vec(payload)
            .map_err(|error| backend_error(stage, -5, format!("序列化请求失败：{error}")))?;
        request = request.body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| backend_error(stage, -7, format!("HTTP 请求失败：{error}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| backend_error(stage, -7, format!("读取 HTTP 响应失败：{error}")))?;
    if text.trim().is_empty() {
        if status.is_success() {
            return Ok(Value::Null);
        }
        return Err(backend_error(
            stage,
            status.as_u16() as i32,
            format!("HTTP 请求失败：{}", status.as_u16()),
        ));
    }
    let data = parse_json_response_text(&text, stage, "")?;
    if !status.is_success() {
        return Err(backend_error(
            stage,
            status.as_u16() as i32,
            json_error_message(&data, "HTTP 请求失败"),
        ));
    }
    Ok(data)
}

/// 严格版 GET：专为迅雷目录接口等需要从错误正文提取消息的场景封装，失败时回退文案为"迅雷目录接口请求失败"。
pub async fn run_http_json_get_strict(
    url: &str,
    headers: &[String],
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    let response = http_client()
        .get(url)
        .headers(parse_http_headers(headers, stage)?)
        .timeout(Duration::from_secs(max_time as u64))
        .send()
        .await
        .map_err(|error| backend_error(stage, -7, format!("HTTP 请求失败：{error}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| backend_error(stage, -7, format!("读取 HTTP 响应失败：{error}")))?;
    let data = parse_json_response_text(&text, stage, "")?;
    if !status.is_success() {
        return Err(backend_error(
            stage,
            status.as_u16() as i32,
            json_error_message(&data, "迅雷目录接口请求失败"),
        ));
    }
    Ok(data)
}

/// 发送表单请求（`form_body` 作为原始字节），委托 [`run_http_request`] 解析 JSON 返回。
pub async fn run_http_form_request(
    method: &str,
    url: &str,
    headers: &[String],
    form_body: Option<&str>,
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    run_http_request(
        method,
        url,
        headers,
        form_body.map(|body| body.as_bytes().to_vec()),
        stage,
        max_time,
        "",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_with_params_should_encode_special_characters() {
        assert_eq!(
            "https://example.com/path?stoken=abc%2B%2F%3D&empty=",
            url_with_params(
                "https://example.com/path",
                &[("stoken", "abc+/=".to_string()), ("empty", "".to_string())],
            ),
        );
    }

    #[test]
    fn as_u32_should_extract_number_and_fallback_for_non_numbers() {
        assert_eq!(42, as_u32(Some(&serde_json::json!(42))));
        assert_eq!(
            0,
            as_u32(Some(&serde_json::json!("42"))),
            "string falls back to 0"
        );
        assert_eq!(
            0,
            as_u32(Some(&serde_json::json!(true))),
            "bool falls back to 0"
        );
        assert_eq!(
            0,
            as_u32(Some(&serde_json::json!(null))),
            "null falls back to 0"
        );
        assert_eq!(0, as_u32(None), "missing value falls back to 0");
    }

    #[test]
    fn as_string_should_extract_string_and_empty_for_others() {
        assert_eq!("hi", as_string(Some(&serde_json::json!("hi"))));
        assert_eq!(
            "",
            as_string(Some(&serde_json::json!(42))),
            "number -> empty"
        );
        assert_eq!(
            "",
            as_string(Some(&serde_json::json!(true))),
            "bool -> empty"
        );
        assert_eq!(
            "",
            as_string(Some(&serde_json::json!(null))),
            "null -> empty"
        );
        assert_eq!("", as_string(None), "missing -> empty");
    }

    #[test]
    fn percent_encode_should_percent_escape_reserved_bytes() {
        assert_eq!("abc-_.~", percent_encode("abc-_.~"), "unreserved preserved");
        assert_eq!("a%20b%26%E4%B8%AD", percent_encode("a b&中"));
    }

    #[test]
    fn percent_decode_should_roundtrip_encoded_strings() {
        let original = "a b&c中=?%";
        assert_eq!(original, percent_decode(&percent_encode(original)));
    }

    #[test]
    fn extract_query_param_should_read_first_value_and_skip_empty() {
        assert_eq!(
            Some("abc".to_string()),
            extract_query_param("https://x.com/s?token=abc", "token"),
        );
        assert_eq!(
            Some("xyz".to_string()),
            extract_query_param("https://x.com/s?a=1&token=xyz", "token"),
        );
        assert_eq!(
            Some("abc".to_string()),
            extract_query_param("https://x.com/s?token=abc#frag", "token"),
            "fragment is ignored",
        );
        assert_eq!(
            None,
            extract_query_param("https://x.com/s?token=", "token"),
            "empty value yields None",
        );
        assert_eq!(None, extract_query_param("https://x.com/s", "token"));
        assert_eq!(
            None,
            extract_query_param("https://x.com/s?other=1", "token"),
            "absent key yields None",
        );
    }

    #[test]
    fn take_url_token_after_should_extract_token_or_none() {
        assert_eq!(
            Some("ABC123def".to_string()),
            take_url_token_after("https://pan.xunlei.com/s/ABC123def", "/s/"),
        );
        assert_eq!(
            None,
            take_url_token_after("https://x.com/s/", "/s/"),
            "empty token after marker yields None",
        );
        assert_eq!(
            None,
            take_url_token_after("https://x.com/nope", "/s/"),
            "missing marker yields None",
        );
    }

    #[test]
    fn form_encode_pairs_should_encode_pairs_and_special_chars() {
        assert_eq!(
            "a=1&b=2",
            form_encode_pairs(&[("a", "1".to_string()), ("b", "2".to_string())]),
        );
        assert_eq!(
            "name=a%20b%26c",
            form_encode_pairs(&[("name", "a b&c".to_string())]),
        );
    }

    #[test]
    fn append_cookie_should_join_or_initialize() {
        assert_eq!(
            "k=v",
            append_cookie("", "k", "v"),
            "empty existing starts fresh"
        );
        assert_eq!("a=1; k=v", append_cookie("a=1", "k", "v"));
        assert_eq!(
            "a=1;; k=v",
            append_cookie("a=1; ", "k", "v"),
            "trailing whitespace is trimmed, semicolon retained",
        );
        assert_eq!(
            "a=1",
            append_cookie("a=1", "k", ""),
            "empty value keeps existing"
        );
        assert_eq!(
            "a=1",
            append_cookie("a=1", "k", "  "),
            "whitespace value keeps existing"
        );
    }

    #[test]
    fn generated_passcode_should_return_four_lowercase_alphanumeric_chars() {
        let code = generated_passcode();
        assert_eq!(4, code.len());
        assert!(
            code.chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit()),
            "passcode charset is [a-z0-9], got {code}",
        );
    }

    #[test]
    fn json_scalar_to_string_should_render_scalars_only() {
        assert_eq!("hi", json_scalar_to_string(Some(&serde_json::json!("hi"))));
        assert_eq!("42", json_scalar_to_string(Some(&serde_json::json!(42))));
        assert_eq!(
            "true",
            json_scalar_to_string(Some(&serde_json::json!(true)))
        );
        assert_eq!(
            "false",
            json_scalar_to_string(Some(&serde_json::json!(false)))
        );
        assert_eq!("", json_scalar_to_string(Some(&serde_json::json!(null))));
        assert_eq!(
            "",
            json_scalar_to_string(Some(&serde_json::json!({"a": 1}))),
            "object -> empty"
        );
        assert_eq!(
            "",
            json_scalar_to_string(Some(&serde_json::json!([1, 2]))),
            "array -> empty"
        );
        assert_eq!("", json_scalar_to_string(None));
    }

    #[test]
    fn json_error_message_should_extract_message_or_code_or_fallback() {
        assert_eq!(
            "fail".to_string(),
            json_error_message(&serde_json::json!({"message": "fail"}), "请求失败"),
        );
        assert_eq!(
            "alt".to_string(),
            json_error_message(&serde_json::json!({"msg": "alt"}), "请求失败"),
            "falls back to msg field",
        );
        assert_eq!(
            "请求失败，接口返回 code=1".to_string(),
            json_error_message(&serde_json::json!({"code": 1}), "请求失败"),
        );
        assert_eq!(
            "请求失败，接口返回 code=2".to_string(),
            json_error_message(&serde_json::json!({"errno": 2}), "请求失败"),
            "falls back to errno field",
        );
        assert_eq!(
            "请求失败".to_string(),
            json_error_message(&serde_json::json!({}), "请求失败"),
            "nothing found -> fallback",
        );
    }
}
