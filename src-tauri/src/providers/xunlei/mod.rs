//! 迅雷网盘业务逻辑：设备码 / 密码登录、验证码刷新、二次验证、转存与新建分享。
//!
//! 该模块体量较大，集中了迅雷 SDK 的设备码 OAuth2、验证码面板与转存流程。
//! 纯哈希 / 签名原语已抽离至子模块 [`util`]。

mod util;
use util::*;
// 重新导出哈希工具，供 `auth::windows` 等模块经 `xunlei::xunlei_hash_hex` 调用。
pub(crate) use util::xunlei_hash_hex;

use qrcode::render::svg;
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::config::{
    XUNLEI_API_BASE, XUNLEI_APP_ID, XUNLEI_CAPTCHA_ALGORITHMS, XUNLEI_CLIENT_ID,
    XUNLEI_CLIENT_SECRET, XUNLEI_CLIENT_VERSION, XUNLEI_CORE_USER_AGENT, XUNLEI_PACKAGE_NAME,
    XUNLEI_SIGN_PROVIDER, XUNLEI_WEB_USER_AGENT,
};
use crate::error::{backend_error, backend_error_with_details, BackendClientError};
use crate::http::client::{
    as_string, extract_query_param, generated_passcode, json_error_message, json_scalar_to_string,
    run_http_json_get_strict, run_http_json_request, run_http_json_request_strict,
    take_url_token_after, url_with_params, EmptyStringFallback,
};
use crate::providers::normalize_xunlei_parent_id;
use crate::types::{
    ProviderLoginResult, ProviderTransferResult, XunleiLoginCheckResult, XunleiLoginQrResult,
};

#[derive(Debug, Clone)]
struct XunleiDeviceLogin {
    device_code: String,
    user_code: String,
    qrcode_url: String,
    expires_in: u32,
    device_id: String,
}

#[derive(Debug, Clone)]
pub(crate) struct XunleiLoginSession {
    device_code: String,
    device_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XunleiCredential {
    token_type: String,
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    user_id: String,
    #[serde(default)]
    captcha_token: String,
    client_id: String,
    #[serde(default)]
    client_secret: String,
    client_version: String,
    #[serde(default)]
    package_name: String,
    device_id: String,
    pub(crate) api_base: String,
}

static XUNLEI_LOGIN_SESSIONS: OnceLock<Mutex<HashMap<String, XunleiLoginSession>>> =
    OnceLock::new();

/// 返回迅雷扫码登录会话表（`account_id` -> device_code/device_id）的全局单例。
pub(crate) fn xunlei_login_sessions() -> &'static Mutex<HashMap<String, XunleiLoginSession>> {
    XUNLEI_LOGIN_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 从迅雷分享链接中提取 share_id：优先取 `share_id` 查询参数，否则取 `/s/` 之后的 token。
pub fn extract_xunlei_share_id(url: &str) -> Option<String> {
    extract_query_param(url, "share_id").or_else(|| take_url_token_after(url, "/s/"))
}

/// 计算迅雷验证码签名：把 `client_id + client_version + package_name + device_id + timestamp` 与配置算法串逐轮 MD5，返回 `(timestamp, "1.{sign}")`。
fn xunlei_captcha_sign(credential: &XunleiCredential) -> (String, String) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let package_name = if credential.package_name.trim().is_empty() {
        XUNLEI_PACKAGE_NAME
    } else {
        credential.package_name.trim()
    };
    let mut sign_source = format!(
        "{}{}{}{}{}",
        credential.client_id,
        credential.client_version,
        package_name,
        credential.device_id,
        timestamp
    );
    for algorithm in XUNLEI_CAPTCHA_ALGORITHMS {
        sign_source = md5_hex(&format!("{sign_source}{algorithm}"));
    }
    (timestamp, format!("1.{sign_source}"))
}

/// 拼接迅雷请求的 `Authorization` 头：`{token_type} {access_token}`，token_type 为空时用 `Bearer`。
fn xunlei_authorization(credential: &XunleiCredential) -> String {
    let token_type = if credential.token_type.trim().is_empty() {
        "Bearer"
    } else {
        credential.token_type.trim()
    };
    format!("{token_type} {}", credential.access_token.trim())
}

/// 构造迅雷 API 请求头（带 Authorization / 验证码 token / 设备与客户端信息，用于带请求体的接口）。
fn xunlei_headers(credential: &XunleiCredential) -> Vec<String> {
    let mut headers = vec![
        format!("Authorization: {}", xunlei_authorization(credential)),
        format!("X-Captcha-Token: {}", credential.captcha_token.trim()),
        "Accept: application/json;charset=UTF-8".to_string(),
        "Accept-Encoding: identity".to_string(),
        "Content-Type: application/json".to_string(),
        format!("User-Agent: {}", XUNLEI_WEB_USER_AGENT),
        format!("x-device-id: {}", credential.device_id),
        format!("x-client-id: {}", credential.client_id),
        format!("x-client-version: {}", credential.client_version),
    ];
    headers.retain(|header| !header.ends_with(": "));
    headers
}

/// 构造迅雷 GET 请求头（与 `xunlei_headers` 类似但不含 `Content-Type`）。
fn xunlei_get_headers(credential: &XunleiCredential) -> Vec<String> {
    let mut headers = vec![
        format!("Authorization: {}", xunlei_authorization(credential)),
        format!("X-Captcha-Token: {}", credential.captcha_token.trim()),
        "Accept: application/json;charset=UTF-8".to_string(),
        "Accept-Encoding: identity".to_string(),
        format!("User-Agent: {}", XUNLEI_WEB_USER_AGENT),
        format!("x-device-id: {}", credential.device_id),
        format!("x-client-id: {}", credential.client_id),
        format!("x-client-version: {}", credential.client_version),
    ];
    headers.retain(|header| !header.ends_with(": "));
    headers
}

/// 构造迅雷通用请求头（无鉴权 token，按传入 UA 适配 Web / Core 两种客户端），用于登录前的设备码与令牌接口。
fn xunlei_common_headers_with_user_agent(
    credential: &XunleiCredential,
    user_agent: &str,
) -> Vec<String> {
    vec![
        "Accept: application/json;charset=UTF-8".to_string(),
        "Accept-Encoding: identity".to_string(),
        "Content-Type: application/json".to_string(),
        format!("User-Agent: {}", user_agent),
        format!("x-device-id: {}", credential.device_id),
        format!("x-client-id: {}", credential.client_id),
        format!("x-client-version: {}", credential.client_version),
    ]
}

/// 检查迅雷响应体中的错误字段（`error` / `error_description` / `error_code`），`error=success` 或无任何错误时返回 `None`，否则返回 `BackendClientError`。
fn xunlei_api_body_error(data: &Value, stage: &str, fallback: &str) -> Option<BackendClientError> {
    let error = as_string(data.get("error"));
    if error == "success" {
        return None;
    }
    let error_description = as_string(data.get("error_description"))
        .if_empty_then(|| as_string(data.get("errorDesc")))
        .if_empty_then(|| as_string(data.get("errorDescUrl")));
    let error_code = json_scalar_to_string(data.get("error_code"))
        .if_empty_then(|| json_scalar_to_string(data.get("errorCode")))
        .parse::<i32>()
        .unwrap_or(0);
    if error_code == 0 && error.is_empty() && error_description.is_empty() {
        return None;
    }
    let message = if !error_description.is_empty() && !error.is_empty() {
        format!("{error}：{error_description}")
    } else {
        error_description
            .if_empty_then(|| error)
            .if_empty_then(|| json_error_message(data, fallback))
    };
    Some(backend_error(stage, error_code, message))
}

/// 判断错误是否需要刷新验证码 token（code=9 或信息含「验证码无效」/captcha 等关键字）。
fn xunlei_error_requires_captcha_refresh(error: &BackendClientError) -> bool {
    let message = error.message.to_ascii_lowercase();
    error.code == 9
        || message.contains("验证码无效")
        || message.contains("captcha")
        || message.contains("captcha_token")
        || message.contains("x-captcha-token")
}

/// 检测迅雷 `review_panel` / code 1007 二次验证响应，组装带 `creditKey` / `deviceSign` / `reviewUrl` 详情的错误，供前端打开验证页。
fn xunlei_review_panel_error(
    data: &Value,
    credential: &XunleiCredential,
) -> Option<BackendClientError> {
    let error = as_string(data.get("error"));
    let error_code = json_scalar_to_string(data.get("error_code"))
        .if_empty_then(|| json_scalar_to_string(data.get("errorCode")))
        .parse::<i32>()
        .unwrap_or(0);
    if error != "review_panel" && error_code != 1007 {
        return None;
    }

    let device_sign = xunlei_generate_device_sign(&credential.device_id, &credential.package_name);
    let raw_review_url = as_string(data.get("reviewurl"))
        .if_empty_then(|| as_string(data.get("reviewUrl")))
        .if_empty_then(|| as_string(data.get("review_url")))
        .if_empty_then(|| as_string(data.get("errorDescUrl")))
        .if_empty_then(|| as_string(data.get("error_desc_url")));
    let review_url = normalize_xunlei_review_url(&raw_review_url);
    let review_url_with_device = if review_url.is_empty() {
        String::new()
    } else if review_url.contains("deviceid=") {
        review_url.clone()
    } else if review_url.contains('?') {
        format!("{review_url}&deviceid={device_sign}")
    } else {
        format!("{review_url}?deviceid={device_sign}")
    };
    let credit_key = as_string(data.get("creditkey"))
        .if_empty_then(|| as_string(data.get("creditKey")))
        .if_empty_then(|| as_string(data.get("credit_key")));
    let raw_message = as_string(data.get("error_description"))
        .if_empty_then(|| as_string(data.get("errorDesc")))
        .if_empty_then(|| json_error_message(data, "Pull verification page"));

    let mut details = HashMap::new();
    details.insert("creditKey".to_string(), credit_key);
    details.insert("deviceId".to_string(), device_sign.clone());
    details.insert("deviceSign".to_string(), device_sign);
    details.insert("rawReviewUrl".to_string(), raw_review_url);
    details.insert("reviewUrl".to_string(), review_url_with_device);
    details.insert("rawMessage".to_string(), raw_message);

    Some(backend_error_with_details(
        "xunlei_review",
        1007,
        "迅雷要求二次验证，请打开验证页完成验证后再点击登录",
        details,
    ))
}

/// 构造一份未登录的迅雷凭证骨架（含默认 client_id/secret 与按 seed 派生的 device_id），作为登录流程的起点。
fn xunlei_empty_credential(seed: &str) -> XunleiCredential {
    XunleiCredential {
        token_type: "Bearer".to_string(),
        access_token: String::new(),
        refresh_token: String::new(),
        expires_in: 0,
        user_id: String::new(),
        captcha_token: String::new(),
        client_id: XUNLEI_CLIENT_ID.to_string(),
        client_secret: XUNLEI_CLIENT_SECRET.to_string(),
        client_version: XUNLEI_CLIENT_VERSION.to_string(),
        package_name: XUNLEI_PACKAGE_NAME.to_string(),
        device_id: xunlei_new_device_id(seed),
        api_base: XUNLEI_API_BASE.to_string(),
    }
}

/// 执行迅雷通用请求（登录前用）：发请求后依次检查 review 面板错误与业务错误，无错误则返回响应。
async fn xunlei_common_request(
    credential: &XunleiCredential,
    method: &str,
    url: &str,
    body: Option<&Value>,
    stage: &str,
    max_time: u32,
    user_agent: &str,
) -> Result<Value, BackendClientError> {
    let data = run_http_json_request_strict(
        method,
        url,
        &xunlei_common_headers_with_user_agent(credential, user_agent),
        body,
        stage,
        max_time,
    )
    .await?;
    if let Some(error) = xunlei_review_panel_error(&data, credential) {
        return Err(error);
    }
    if let Some(error) = xunlei_api_body_error(&data, stage, "迅雷接口请求失败") {
        return Err(error);
    }
    Ok(data)
}

/// 由旧版裸 access_token 构造凭证（无 refresh_token，device_id 由 token 派生），用于兼容历史存储格式。
fn legacy_xunlei_credential(access_token: &str) -> XunleiCredential {
    XunleiCredential {
        token_type: "Bearer".to_string(),
        access_token: access_token.trim().to_string(),
        refresh_token: String::new(),
        expires_in: 0,
        user_id: String::new(),
        captcha_token: String::new(),
        client_id: XUNLEI_CLIENT_ID.to_string(),
        client_secret: XUNLEI_CLIENT_SECRET.to_string(),
        client_version: XUNLEI_CLIENT_VERSION.to_string(),
        package_name: XUNLEI_PACKAGE_NAME.to_string(),
        device_id: xunlei_hash_hex(access_token)
            + &xunlei_hash_hex(&format!("{access_token}:device")),
        api_base: XUNLEI_API_BASE.to_string(),
    }
}

/// 将迅雷凭证序列化为 `xunlei:token_json:{json}` 存储串；序列化失败报 `xunlei_auth` 错误。
pub(crate) fn xunlei_credential_to_storage(
    credential: &XunleiCredential,
) -> Result<String, BackendClientError> {
    serde_json::to_string(credential)
        .map(|json| format!("xunlei:token_json:{json}"))
        .map_err(|error| backend_error("xunlei_auth", -5, format!("保存迅雷凭证失败：{error}")))
}

/// 解析存储串为迅雷凭证：支持 `xunlei:token_json:` 新格式与裸 token 旧格式；校验 access_token 与 client_id，缺失字段用默认值补齐。
pub(crate) fn normalize_xunlei_credential(
    credential: &str,
) -> Result<XunleiCredential, BackendClientError> {
    let trimmed = credential.trim();
    if trimmed.is_empty() {
        return Err(backend_error(
            "xunlei_auth",
            1001,
            "迅雷账号缺少 access token，请重新登录",
        ));
    }

    if let Some(json) = trimmed.strip_prefix("xunlei:token_json:") {
        let mut parsed = serde_json::from_str::<XunleiCredential>(json).map_err(|error| {
            backend_error("xunlei_auth", -2, format!("解析迅雷凭证失败：{error}"))
        })?;
        if parsed.access_token.trim().is_empty() {
            return Err(backend_error(
                "xunlei_auth",
                1001,
                "迅雷账号缺少 access token，请重新登录",
            ));
        }
        if parsed.client_id.trim() != XUNLEI_CLIENT_ID {
            return Err(backend_error(
                "xunlei_auth",
                1002,
                "迅雷凭证来自旧登录方式，无法访问云盘资源，请重新用账号密码登录",
            ));
        }
        if parsed.client_secret.trim().is_empty() {
            parsed.client_secret = XUNLEI_CLIENT_SECRET.to_string();
        }
        if parsed.client_version.trim().is_empty() {
            parsed.client_version = XUNLEI_CLIENT_VERSION.to_string();
        }
        if parsed.package_name.trim().is_empty() {
            parsed.package_name = XUNLEI_PACKAGE_NAME.to_string();
        }
        if parsed.api_base.trim().is_empty() {
            parsed.api_base = XUNLEI_API_BASE.to_string();
        }
        return Ok(parsed);
    }

    let access_token = trimmed
        .strip_prefix("xunlei:access_token:")
        .unwrap_or(trimmed)
        .to_string();
    Ok(legacy_xunlei_credential(&access_token))
}

/// 构造迅雷 OAuth2 鉴权接口请求头（无 token，带 Origin/Referer 与 Web UA），用于设备码与令牌接口。
fn xunlei_auth_headers(device_id: &str) -> Vec<String> {
    let _ = device_id;
    vec![
        "Accept: application/json".to_string(),
        "Accept-Encoding: identity".to_string(),
        "Content-Type: application/json".to_string(),
        "Origin: https://i.xunlei.com".to_string(),
        "Referer: https://i.xunlei.com/".to_string(),
        format!("User-Agent: {}", XUNLEI_WEB_USER_AGENT),
    ]
}

/// 根据用户名形态选择验证码 meta 字段名：邮箱用 `email`、手机号用 `phone_number`、其余用 `username`。
fn xunlei_login_meta_key(username: &str) -> &'static str {
    let trimmed = username.trim();
    if trimmed.contains('@') && trimmed.contains('.') {
        "email"
    } else if (11..=18).contains(&trimmed.chars().count()) {
        "phone_number"
    } else {
        "username"
    }
}

/// 构造登录验证码初始化的 meta 对象（仅含用户名对应字段，不带 timestamp / captcha_sign）。
fn xunlei_login_captcha_meta(username: &str) -> serde_json::Map<String, Value> {
    let mut meta = serde_json::Map::new();
    meta.insert(
        xunlei_login_meta_key(username).to_string(),
        Value::String(username.trim().to_string()),
    );
    meta
}

/// 登录前刷新验证码 token：调用 captcha/init，若返回人工验证 URL 报 `xunlei_captcha` 错误，成功则写入 `captcha_token`。
async fn xunlei_refresh_captcha_for_login(
    credential: &mut XunleiCredential,
    action: &str,
    username: &str,
) -> Result<(), BackendClientError> {
    let body = serde_json::json!({
        "action": action,
        "captcha_token": credential.captcha_token,
        "client_id": credential.client_id,
        "device_id": credential.device_id,
        "meta": Value::Object(xunlei_login_captcha_meta(username)),
        "redirect_uri": "xlaccsdk01://xunlei.com/callback?state=harbor"
    });
    let data = xunlei_common_request(
        credential,
        "POST",
        "https://xluser-ssl.xunlei.com/v1/shield/captcha/init",
        Some(&body),
        "xunlei_captcha",
        20,
        XUNLEI_WEB_USER_AGENT,
    )
    .await?;
    let verify_url = as_string(data.get("url"));
    if !verify_url.is_empty() {
        return Err(backend_error(
            "xunlei_captcha",
            1003,
            format!("迅雷需要人工安全验证：{verify_url}"),
        ));
    }
    let captcha_token = as_string(data.get("captcha_token"));
    if captcha_token.is_empty() {
        return Err(backend_error(
            "xunlei_captcha",
            1002,
            json_error_message(&data, "迅雷未返回验证码 token"),
        ));
    }
    credential.captcha_token = captcha_token;
    Ok(())
}

/// 登录后刷新验证码 token：带 `captcha_sign` 调用 captcha/init，逻辑同登录前刷新但 meta 含 user_id 与签名。
async fn xunlei_refresh_captcha_after_login(
    credential: &mut XunleiCredential,
    action: &str,
) -> Result<(), BackendClientError> {
    if credential.user_id.trim().is_empty() {
        return Err(backend_error(
            "xunlei_captcha",
            1002,
            "迅雷未返回用户 ID，无法刷新验证码 token，请重新登录",
        ));
    }
    let (timestamp, captcha_sign) = xunlei_captcha_sign(credential);
    let body = serde_json::json!({
        "action": action,
        "captcha_token": credential.captcha_token,
        "client_id": credential.client_id,
        "device_id": credential.device_id,
        "meta": {
            "client_version": credential.client_version,
            "package_name": credential.package_name,
            "user_id": credential.user_id,
            "timestamp": timestamp,
            "captcha_sign": captcha_sign
        },
        "redirect_uri": "xlaccsdk01://xunlei.com/callback?state=harbor"
    });
    let data = xunlei_common_request(
        credential,
        "POST",
        "https://xluser-ssl.xunlei.com/v1/shield/captcha/init",
        Some(&body),
        "xunlei_captcha",
        20,
        XUNLEI_WEB_USER_AGENT,
    )
    .await?;
    let verify_url = as_string(data.get("url"));
    if !verify_url.is_empty() {
        return Err(backend_error(
            "xunlei_captcha",
            1003,
            format!("迅雷需要人工安全验证：{verify_url}"),
        ));
    }
    let captcha_token = as_string(data.get("captcha_token"));
    if captcha_token.is_empty() {
        return Err(backend_error(
            "xunlei_captcha",
            1002,
            json_error_message(&data, "迅雷未返回验证码 token"),
        ));
    }
    credential.captcha_token = captcha_token;
    Ok(())
}

/// 用 refresh_token 换取新的 access_token 并更新凭证字段；refresh_token 为空时报 `xunlei_token` 错误。
async fn xunlei_refresh_access_token(
    credential: &mut XunleiCredential,
) -> Result<(), BackendClientError> {
    if credential.refresh_token.trim().is_empty() {
        return Err(backend_error(
            "xunlei_token",
            1002,
            "迅雷 refresh token 为空，请重新登录",
        ));
    }
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": credential.refresh_token,
        "client_id": credential.client_id,
        "client_secret": credential.client_secret
    });
    let data = xunlei_common_request(
        credential,
        "POST",
        "https://xluser-ssl.xunlei.com/v1/auth/token",
        Some(&body),
        "xunlei_token",
        20,
        XUNLEI_WEB_USER_AGENT,
    )
    .await?;
    let access_token = as_string(data.get("access_token"));
    if access_token.is_empty() {
        return Err(backend_error(
            "xunlei_token",
            1002,
            json_error_message(&data, "迅雷刷新 token 失败"),
        ));
    }
    credential.token_type =
        as_string(data.get("token_type")).if_empty_then(|| "Bearer".to_string());
    credential.access_token = access_token;
    credential.refresh_token =
        as_string(data.get("refresh_token")).if_empty_then(|| credential.refresh_token.clone());
    credential.expires_in = data.get("expires_in").and_then(Value::as_u64).unwrap_or(0);
    credential.user_id =
        as_string(data.get("user_id")).if_empty_then(|| as_string(data.get("sub")));
    Ok(())
}

/// 执行迅雷 core 登录（密码 + creditkey，Android 客户端协议），返回 sessionID 供后续 token 接口使用。
async fn xunlei_core_login(
    credential: &mut XunleiCredential,
    username: &str,
    password: &str,
    credit_key: &str,
) -> Result<String, BackendClientError> {
    let body = serde_json::json!({
        "protocolVersion": "301",
        "sequenceNo": "1000012",
        "platformVersion": "10",
        "isCompressed": "0",
        "appid": XUNLEI_APP_ID,
        "clientVersion": XUNLEI_CLIENT_VERSION,
        "peerID": "00000000000000000000000000000000",
        "appName": "ANDROID-com.xunlei.downloadprovider",
        "sdkVersion": "512000",
        "devicesign": xunlei_generate_device_sign(&credential.device_id, &credential.package_name),
        "netWorkType": "WIFI",
        "providerName": "NONE",
        "deviceModel": "M2004J7AC",
        "deviceName": "Xiaomi_M2004j7ac",
        "OSVersion": "12",
        "creditkey": credit_key.trim(),
        "hl": "zh-CN",
        "userName": username.trim(),
        "passWord": password,
        "verifyKey": "",
        "verifyCode": "",
        "isMd5Pwd": "0"
    });
    let data = xunlei_common_request(
        credential,
        "POST",
        "https://xluser-ssl.xunlei.com/xluser.core.login/v3/login",
        Some(&body),
        "xunlei_core_login",
        20,
        XUNLEI_CORE_USER_AGENT,
    )
    .await?;
    let session_id = as_string(data.get("sessionID"));
    if session_id.is_empty() {
        return Err(backend_error(
            "xunlei_core_login",
            1002,
            json_error_message(&data, "迅雷登录未返回 sessionID"),
        ));
    }
    Ok(session_id)
}

/// 迅雷账号密码登录全流程：core 登录拿 sessionID → 刷新验证码 → 换 access_token → 返回登录信息；账号或密码为空时报 `xunlei_login` 错误。
pub(crate) async fn xunlei_password_login(
    account_id: &str,
    username: &str,
    password: &str,
    credit_key: &str,
) -> Result<ProviderLoginResult, BackendClientError> {
    if username.trim().is_empty() || password.is_empty() {
        return Err(backend_error("xunlei_login", 1001, "请填写迅雷账号和密码"));
    }
    let mut credential = xunlei_empty_credential(&format!("{account_id}:{}", username.trim()));
    let session_id = xunlei_core_login(&mut credential, username, password, credit_key).await?;
    let signin_url = "https://xluser-ssl.xunlei.com/v1/auth/signin/token";
    xunlei_refresh_captcha_for_login(
        &mut credential,
        &xunlei_action("POST", signin_url),
        username,
    )
    .await?;
    let body = serde_json::json!({
        "client_id": credential.client_id,
        "client_secret": credential.client_secret,
        "provider": XUNLEI_SIGN_PROVIDER,
        "signin_token": session_id
    });
    let data = xunlei_common_request(
        &credential,
        "POST",
        signin_url,
        Some(&body),
        "xunlei_token",
        20,
        XUNLEI_WEB_USER_AGENT,
    )
    .await?;
    let access_token = as_string(data.get("access_token"));
    if access_token.is_empty() {
        return Err(backend_error(
            "xunlei_token",
            1002,
            json_error_message(&data, "迅雷未返回 access token"),
        ));
    }
    credential.token_type =
        as_string(data.get("token_type")).if_empty_then(|| "Bearer".to_string());
    credential.access_token = access_token;
    credential.refresh_token = as_string(data.get("refresh_token"));
    credential.expires_in = data.get("expires_in").and_then(Value::as_u64).unwrap_or(0);
    credential.user_id =
        as_string(data.get("user_id")).if_empty_then(|| as_string(data.get("sub")));

    xunlei_account_info(&xunlei_credential_to_storage(&credential)?).await
}

/// 发起迅雷设备码 OAuth2：申请 device_code / user_code / 扫码地址，用于扫码登录入口。
async fn xunlei_device_login(account_id: &str) -> Result<XunleiDeviceLogin, BackendClientError> {
    let device_id = xunlei_new_device_id(account_id);
    let headers = xunlei_auth_headers(&device_id);
    let data = run_http_json_request(
        "POST",
        "https://xluser-ssl.xunlei.com/v1/auth/device/code",
        &headers,
        Some(&serde_json::json!({ "client_id": XUNLEI_CLIENT_ID })),
        "xunlei_qrcode",
        20,
    )
    .await?;
    let device_code = as_string(data.get("device_code"));
    let user_code = as_string(data.get("user_code"));
    let short_url = as_string(data.get("short_uri_complete"));
    let qrcode_url =
        as_string(data.get("verification_uri_complete")).if_empty_then(|| short_url.clone());
    let expires_in = data
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(120) as u32;
    if device_code.is_empty() || qrcode_url.is_empty() {
        return Err(backend_error("xunlei_qrcode", -4, "迅雷未返回扫码登录地址"));
    }
    Ok(XunleiDeviceLogin {
        device_code,
        user_code,
        qrcode_url,
        expires_in,
        device_id,
    })
}

/// 将扫码 URL 渲染为 260×260 的 SVG 二维码字符串。
fn xunlei_qrcode_svg(value: &str) -> Result<String, BackendClientError> {
    let code = QrCode::new(value.as_bytes()).map_err(|error| {
        backend_error("xunlei_qrcode", -5, format!("生成迅雷二维码失败：{error}"))
    })?;
    Ok(code
        .render::<svg::Color<'_>>()
        .min_dimensions(260, 260)
        .dark_color(svg::Color("#111827"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

/// 启动迅雷扫码登录：申请设备码并缓存会话，返回二维码 SVG / user_code / 有效期。
pub(crate) async fn start_xunlei_login(
    account_id: &str,
) -> Result<XunleiLoginQrResult, BackendClientError> {
    let login = xunlei_device_login(account_id).await?;
    let mut sessions = xunlei_login_sessions()
        .lock()
        .map_err(|_| backend_error("xunlei_qrcode", -7, "迅雷登录会话锁定失败"))?;
    sessions.insert(
        account_id.to_string(),
        XunleiLoginSession {
            device_code: login.device_code.clone(),
            device_id: login.device_id.clone(),
        },
    );
    drop(sessions);

    Ok(XunleiLoginQrResult {
        user_code: login.user_code,
        qrcode_svg: xunlei_qrcode_svg(&login.qrcode_url)?,
        qrcode_url: login.qrcode_url,
        expires_in: login.expires_in,
    })
}

/// 尝试用 device_code 换 access_token：授权未完返回 `Ok(None)`，授权完成返回凭证，二维码过期 / 验证码无效返回对应错误。
pub(crate) async fn xunlei_try_device_token(
    session: &XunleiLoginSession,
) -> Result<Option<XunleiCredential>, BackendClientError> {
    let headers = xunlei_auth_headers(&session.device_id);
    let data = match run_http_json_request(
        "POST",
        "https://xluser-ssl.xunlei.com/v1/auth/token",
        &headers,
        Some(&serde_json::json!({
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": session.device_code,
            "client_id": XUNLEI_CLIENT_ID
        })),
        "xunlei_token",
        20,
    )
    .await
    {
        Ok(data) => data,
        Err(error) if matches!(error.code, 408 | 429) => {
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let access_token = as_string(data.get("access_token"));
    if access_token.is_empty() {
        let error = as_string(data.get("error"));
        let error_code = json_scalar_to_string(data.get("error_code"))
            .parse::<i32>()
            .unwrap_or(400);
        if error == "expired_token" || error_code == 4052 {
            return Err(backend_error(
                "xunlei_token",
                4052,
                "迅雷二维码已过期，请重新生成二维码后扫码",
            ));
        }
        if error == "invalid_grant" || error == "invalid_code" || error.contains("captcha") {
            return Err(backend_error(
                "xunlei_token",
                error_code,
                "迅雷扫码验证码无效，请重新生成二维码后扫码",
            ));
        }
        if !error.is_empty() && error != "authorization_pending" {
            return Err(backend_error(
                "xunlei_token",
                error_code,
                json_error_message(&data, "迅雷扫码授权失败"),
            ));
        }
        return Ok(None);
    }
    Ok(Some(XunleiCredential {
        token_type: as_string(data.get("token_type")).if_empty_then(|| "Bearer".to_string()),
        access_token,
        refresh_token: as_string(data.get("refresh_token")),
        expires_in: data.get("expires_in").and_then(Value::as_u64).unwrap_or(0),
        user_id: as_string(data.get("user_id")).if_empty_then(|| as_string(data.get("sub"))),
        captcha_token: String::new(),
        client_id: XUNLEI_CLIENT_ID.to_string(),
        client_secret: XUNLEI_CLIENT_SECRET.to_string(),
        client_version: XUNLEI_CLIENT_VERSION.to_string(),
        package_name: XUNLEI_PACKAGE_NAME.to_string(),
        device_id: session.device_id.clone(),
        api_base: XUNLEI_API_BASE.to_string(),
    }))
}

/// 轮询迅雷扫码授权结果，未完成时报 `xunlei_token` 错误（等待用户扫码）。
pub(crate) async fn xunlei_poll_device_token(
    session: &XunleiLoginSession,
) -> Result<XunleiCredential, BackendClientError> {
    xunlei_try_device_token(session).await?.ok_or_else(|| {
        backend_error(
            "xunlei_token",
            1002,
            "迅雷扫码授权未完成，请使用手机迅雷扫码后稍等",
        )
    })
}

/// 执行迅雷带鉴权的 JSON 请求（带请求体）：遇到验证码失效自动刷新、token 过期自动 refresh，最多重试 3 次。
async fn xunlei_json_request(
    credential: &mut XunleiCredential,
    method: &str,
    url: &str,
    body: Option<&Value>,
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    let mut last_error = None;
    for _ in 0..3 {
        let data = match run_http_json_request_strict(
            method,
            url,
            &xunlei_headers(credential),
            body,
            stage,
            max_time,
        )
        .await
        {
            Ok(data) => data,
            Err(error) if xunlei_error_requires_captcha_refresh(&error) => {
                xunlei_refresh_captcha_after_login(credential, &xunlei_action(method, url)).await?;
                last_error = Some(error);
                continue;
            }
            Err(error) => return Err(error),
        };
        if let Some(error) = xunlei_api_body_error(&data, stage, "迅雷接口请求失败") {
            if matches!(error.code, 4122 | 4121 | 10 | 16) {
                xunlei_refresh_access_token(credential).await?;
                last_error = Some(error);
                continue;
            }
            if xunlei_error_requires_captcha_refresh(&error) {
                xunlei_refresh_captcha_after_login(credential, &xunlei_action(method, url)).await?;
                last_error = Some(error);
                continue;
            }
            return Err(error);
        }
        return Ok(data);
    }
    Err(last_error.unwrap_or_else(|| backend_error(stage, 1002, "迅雷接口重试失败")))
}

/// 执行迅雷带鉴权的 GET 请求：重试与自动刷新逻辑同 `xunlei_json_request`，用于只读接口。
pub(crate) async fn xunlei_json_get(
    credential: &mut XunleiCredential,
    url: &str,
    stage: &str,
    max_time: u32,
) -> Result<Value, BackendClientError> {
    let mut last_error = None;
    for _ in 0..3 {
        let data =
            match run_http_json_get_strict(url, &xunlei_get_headers(credential), stage, max_time)
                .await
            {
                Ok(data) => data,
                Err(error) if xunlei_error_requires_captcha_refresh(&error) => {
                    xunlei_refresh_captcha_after_login(credential, &xunlei_action("GET", url))
                        .await?;
                    last_error = Some(error);
                    continue;
                }
                Err(error) => return Err(error),
            };
        if let Some(error) = xunlei_api_body_error(&data, stage, "迅雷接口请求失败") {
            if matches!(error.code, 4122 | 4121 | 10 | 16) {
                xunlei_refresh_access_token(credential).await?;
                last_error = Some(error);
                continue;
            }
            if xunlei_error_requires_captcha_refresh(&error) {
                xunlei_refresh_captcha_after_login(credential, &xunlei_action("GET", url)).await?;
                last_error = Some(error);
                continue;
            }
            return Err(error);
        }
        return Ok(data);
    }
    Err(last_error.unwrap_or_else(|| backend_error(stage, 1002, "迅雷接口重试失败")))
}

/// 校验迅雷凭证能否访问云盘目录：依次尝试凭证自带 api_base 与默认 base，401/403 提示重新登录，成功返回可用 api_base。
pub(crate) async fn xunlei_validate_drive_access(
    credential: &mut XunleiCredential,
) -> Result<String, BackendClientError> {
    let params = [
        ("parent_id", String::new()),
        ("page_token", "0".to_string()),
        ("limit", "1".to_string()),
        ("usage", "DISPLAY".to_string()),
        (
            "filters",
            r#"{"phase":{"eq":"PHASE_TYPE_COMPLETE"},"trashed":{"eq":false}}"#.to_string(),
        ),
    ];
    let mut last_error = None;
    let api_bases = vec![credential.api_base.clone(), XUNLEI_API_BASE.to_string()];
    for base in api_bases {
        if base.trim().is_empty() {
            continue;
        }
        let url = url_with_params(&format!("{base}/files"), &params);
        match xunlei_json_get(credential, &url, "xunlei_auth", 20).await {
            Ok(data) if data.get("files").and_then(Value::as_array).is_some() => {
                return Ok(base.to_string());
            }
            Ok(data) => {
                last_error = Some(backend_error(
                    "xunlei_auth",
                    1002,
                    json_error_message(&data, "迅雷授权校验未返回文件列表"),
                ));
            }
            Err(error) => {
                last_error = Some(if matches!(error.code, 401 | 403) {
                    backend_error(
                        "xunlei_auth",
                        error.code,
                        format!(
                            "迅雷授权无法访问文件目录：{}，请重新扫码登录",
                            error.message
                        ),
                    )
                } else {
                    error
                });
            }
        }
    }
    Err(last_error.unwrap_or_else(|| {
        backend_error(
            "xunlei_auth",
            1002,
            "迅雷授权无法访问文件目录，请重新扫码登录",
        )
    }))
}

/// 校验迅雷登录态并返回登录信息：先验证目录访问权限，再取用户昵称，最后刷新存储串中的 api_base。
pub(crate) async fn xunlei_account_info(
    credential: &str,
) -> Result<ProviderLoginResult, BackendClientError> {
    let mut credential = normalize_xunlei_credential(credential)?;
    let api_base = xunlei_validate_drive_access(&mut credential).await?;
    credential.api_base = api_base;
    let user = xunlei_json_request(
        &mut credential,
        "GET",
        "https://xluser-ssl.xunlei.com/v1/user/me",
        None,
        "xunlei_account",
        20,
    )
    .await
    .unwrap_or(Value::Null);
    let login_name = as_string(user.get("name")).if_empty_then(|| "迅雷用户".to_string());
    let about_url = format!("{}/about", credential.api_base);
    let _ = xunlei_json_request(&mut credential, "GET", &about_url, None, "xunlei_quota", 20).await;
    Ok(ProviderLoginResult {
        cookie: xunlei_credential_to_storage(&credential)?,
        login_name,
        cookie_count: 1,
    })
}

/// 转存迅雷分享到目标目录并创建新分享：浏览分享取文件 → 直接指定 parent_id 提交转存任务并轮询 → 用已转存文件创建带提取码的新分享。
///
/// 全流程统一走 `api-pan.xunlei.com/drive/v1`（与 alist `thunder` 驱动及列文件接口一致），
/// 不再调用 `/settings` 设置全局 restore_path，避免污染账号默认转存目录。
pub(crate) async fn transfer_xunlei_share(
    credential: &str,
    source_url: &str,
    target_folder_ref: &str,
    title: &str,
) -> Result<ProviderTransferResult, BackendClientError> {
    let mut credential = normalize_xunlei_credential(credential)?;
    let share_id = extract_xunlei_share_id(source_url)
        .ok_or_else(|| backend_error("xunlei_parse", -3, "无法识别迅雷分享链接"))?;
    let pass_code = extract_query_param(source_url, "pwd").unwrap_or_default();
    let browse_url = url_with_params(
        "https://api-pan.xunlei.com/drive/v1/share",
        &[
            ("share_id", share_id.clone()),
            ("pass_code", pass_code),
            ("limit", "100".to_string()),
            ("scene", "NORMAL".to_string()),
            ("order", "DEFAULT_ORDER".to_string()),
        ],
    );
    let browse = xunlei_json_request(
        &mut credential,
        "GET",
        &browse_url,
        None,
        "xunlei_share",
        30,
    )
    .await?;
    let pass_code_token = as_string(browse.get("pass_code_token"));
    let file_ids = browse
        .get("files")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|file| as_string(file.get("id")))
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if file_ids.is_empty() {
        return Err(backend_error(
            "xunlei_share",
            -4,
            "迅雷分享中没有可转存文件",
        ));
    }

    // 目标目录直接作为转存 parent_id 传入（specify_parent_id=true），
    // 无需先调 /settings 设置全局 restore_path——后者会污染账号默认转存路径且较脆弱。
    let parent_id = normalize_xunlei_parent_id(target_folder_ref);
    let restore_body = serde_json::json!({
        "parent_id": parent_id,
        "share_id": share_id.clone(),
        "pass_code_token": pass_code_token,
        "ancestor_ids": [],
        "file_ids": file_ids,
        "specify_parent_id": true
    });
    let restore = xunlei_json_request(
        &mut credential,
        "POST",
        "https://api-pan.xunlei.com/drive/v1/share/restore",
        Some(&restore_body),
        "xunlei_restore",
        45,
    )
    .await?;
    let task_id = as_string(restore.get("restore_task_id"));
    if task_id.is_empty() {
        return Err(backend_error("xunlei_restore", -4, "迅雷未返回转存任务 ID"));
    }

    let mut task = Value::Null;
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(800)).await;
        let url = format!("https://api-pan.xunlei.com/drive/v1/tasks/{task_id}");
        task = xunlei_json_request(&mut credential, "GET", &url, None, "xunlei_task", 20).await?;
        let message = as_string(task.get("message"));
        if message == "完成" || as_string(task.get("phase")) == "PHASE_TYPE_COMPLETE" {
            break;
        }
        if message.contains("失败") || message.contains("错误") {
            return Err(backend_error("xunlei_task", -4, message));
        }
    }

    let mut saved_ids = Vec::new();
    let trace = task
        .get("params")
        .map(|params| as_string(params.get("trace_file_ids")))
        .unwrap_or_default();
    if !trace.is_empty() {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&trace) {
            saved_ids = map
                .values()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect();
        }
    }
    if saved_ids.is_empty() {
        let list_url = url_with_params(
            &format!("{}/files", credential.api_base),
            &[
                ("parent_id", normalize_xunlei_parent_id(target_folder_ref)),
                ("usage", "DISPLAY".to_string()),
                ("limit", "10".to_string()),
            ],
        );
        let list = xunlei_json_request(&mut credential, "GET", &list_url, None, "xunlei_files", 20)
            .await?;
        saved_ids = list
            .get("files")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|file| as_string(file.get("id")))
            .filter(|id| !id.is_empty())
            .collect();
    }
    if saved_ids.is_empty() {
        return Err(backend_error(
            "xunlei_share_create",
            -4,
            "迅雷转存完成，但没有找到已保存文件",
        ));
    }

    let new_pwd = generated_passcode();
    let share_body = serde_json::json!({
        "file_ids": saved_ids.clone(),
        "share_to": "copy",
        "params": {
            "passcode": new_pwd,
            "WithPassCodeInLink": "true"
        }
    });
    let share = xunlei_json_request(
        &mut credential,
        "POST",
        "https://api-pan.xunlei.com/drive/v1/share",
        Some(&share_body),
        "xunlei_share_create",
        30,
    )
    .await?;
    let mut share_url = as_string(share.get("share_url"));
    if share_url.is_empty() {
        return Err(backend_error(
            "xunlei_share_create",
            -4,
            "迅雷未返回新分享链接",
        ));
    }
    if !share_url.contains("pwd=") {
        share_url.push_str(if share_url.contains('?') {
            "&pwd="
        } else {
            "?pwd="
        });
        share_url.push_str(&new_pwd);
    }

    Ok(ProviderTransferResult {
        share_url,
        saved_fids: saved_ids,
        title: title.trim().to_string(),
    })
}

/// 检查迅雷扫码登录状态：未授权返回 `pending`，授权成功则取账号信息、清理会话并返回 `connected`。
pub(crate) async fn check_xunlei_login_status(
    account_id: &str,
) -> Result<XunleiLoginCheckResult, BackendClientError> {
    let session = {
        let sessions = xunlei_login_sessions()
            .lock()
            .map_err(|_| backend_error("xunlei_token", -7, "迅雷登录会话锁定失败"))?;
        sessions.get(account_id).cloned()
    }
    .ok_or_else(|| backend_error("xunlei_token", 1002, "请先生成迅雷授权二维码"))?;

    let Some(credential) = xunlei_try_device_token(&session).await? else {
        return Ok(XunleiLoginCheckResult {
            status: "pending".to_string(),
            result: None,
        });
    };

    let result = xunlei_account_info(&xunlei_credential_to_storage(&credential)?).await?;
    if let Ok(mut sessions) = xunlei_login_sessions().lock() {
        sessions.remove(account_id);
    }

    Ok(XunleiLoginCheckResult {
        status: "connected".to_string(),
        result: Some(result),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::backend_error;

    #[test]
    fn xunlei_review_panel_should_return_verification_details() {
        let mut credential = xunlei_empty_credential("review-test");
        credential.device_id = "device-123".to_string();
        let device_sign =
            xunlei_generate_device_sign(&credential.device_id, &credential.package_name);
        let error = xunlei_review_panel_error(
            &serde_json::json!({
                "error": "review_panel",
                "error_code": 1007,
                "error_description": "Pull verification page",
                "creditkey": "credit-abc",
                "reviewurl": "https://xluser-ssl.xunlei.com/review?foo=bar"
            }),
            &credential,
        )
        .expect("review_panel should expose verification data");

        assert_eq!("xunlei_review", error.stage);
        assert_eq!(1007, error.code);
        assert_eq!(
            Some(&"credit-abc".to_string()),
            error.details.get("creditKey")
        );
        assert_eq!(Some(&device_sign), error.details.get("deviceSign"));
        assert_eq!(
            Some(&format!(
                "https://xluser-ssl.xunlei.com/review?foo=bar&deviceid={device_sign}"
            )),
            error.details.get("reviewUrl"),
        );
    }

    #[test]
    fn xunlei_device_id_should_be_stable_for_same_account() {
        assert_eq!(
            xunlei_new_device_id("xunlei-account:user@example.com"),
            xunlei_new_device_id("xunlei-account:user@example.com")
        );
        assert_ne!(
            xunlei_new_device_id("xunlei-account:user@example.com"),
            xunlei_new_device_id("xunlei-account:other@example.com")
        );
    }

    #[test]
    fn xunlei_login_captcha_meta_should_match_alist_login_flow() {
        let meta = xunlei_login_captcha_meta("18612343924");

        assert_eq!(
            Some(&Value::String("18612343924".to_string())),
            meta.get("phone_number")
        );
        assert!(!meta.contains_key("timestamp"));
        assert!(!meta.contains_key("captcha_sign"));
    }

    #[test]
    fn xunlei_captcha_refresh_should_accept_http_400_captcha_errors() {
        let error = backend_error("xunlei_auth", 400, "验证码无效");

        assert!(xunlei_error_requires_captcha_refresh(&error));
    }

    #[test]
    fn md5_hex_should_match_standard_md5_digest() {
        assert_eq!("900150983cd24fb0d6963f7d28e17f72", md5_hex("abc"));
        assert_eq!("d41d8cd98f00b204e9800998ecf8427e", md5_hex(""));
    }

    #[test]
    fn hex_lower_should_render_bytes_as_lowercase_hex() {
        assert_eq!("00ff12ab", hex_lower(&[0x00, 0xFF, 0x12, 0xAB]));
        assert_eq!("", hex_lower(&[]));
    }

    #[test]
    fn sha1_hex_should_match_standard_sha1_digest() {
        assert_eq!("a9993e364706816aba3e25717850c26c9cd0d89d", sha1_hex("abc"));
    }

    #[test]
    fn xunlei_hash_hex_should_be_stable_and_sixteen_hex_chars() {
        let first = xunlei_hash_hex("xunlei-seed");
        let second = xunlei_hash_hex("xunlei-seed");

        assert_eq!(first, second);
        assert_eq!(16, first.len());
        assert!(first
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (byte >= b'a' && byte <= b'f')));
        assert_ne!(first, xunlei_hash_hex("xunlei-other-seed"));
    }

    #[test]
    fn xunlei_generate_device_sign_should_be_deterministic() {
        let first = xunlei_generate_device_sign("device-abc", XUNLEI_PACKAGE_NAME);
        let second = xunlei_generate_device_sign("device-abc", XUNLEI_PACKAGE_NAME);

        assert_eq!(first, second);
        assert_ne!(
            first,
            xunlei_generate_device_sign("device-other", XUNLEI_PACKAGE_NAME)
        );
    }

    #[test]
    fn xunlei_generate_device_sign_should_match_known_digest() {
        // sha1("device-abc" + XUNLEI_PACKAGE_NAME + XUNLEI_APP_ID + XUNLEI_APP_KEY)
        //   = fc4db0641dabcc3c9116e1b3fa50634c8ba6238e
        // md5(sha1_hex) = 78b578f62a9a0c87d4cf20b078c3afb9
        let sign = xunlei_generate_device_sign("device-abc", XUNLEI_PACKAGE_NAME);

        assert_eq!("div101.device-abc78b578f62a9a0c87d4cf20b078c3afb9", sign);
        assert!(sign.starts_with("div101.device-abc"));
        let suffix = &sign["div101.device-abc".len()..];
        assert_eq!(32, suffix.len());
        assert!(suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (byte >= b'a' && byte <= b'f')));
    }

    #[test]
    fn xunlei_captcha_sign_should_produce_prefixed_md5_suffix() {
        let credential = xunlei_empty_credential("captcha-sign-seed");

        let (timestamp, sign) = xunlei_captcha_sign(&credential);

        assert!(!timestamp.is_empty());
        assert!(timestamp.bytes().all(|byte| byte.is_ascii_digit()));
        assert!(sign.starts_with("1."));
        let suffix = &sign["1.".len()..];
        assert_eq!(32, suffix.len());
        assert!(suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (byte >= b'a' && byte <= b'f')));
    }

    #[test]
    fn xunlei_action_should_build_method_path_pair() {
        assert_eq!(
            "POST:/v1/auth/signin/token",
            xunlei_action("POST", "https://xluser-ssl.xunlei.com/v1/auth/signin/token")
        );
        assert_eq!(
            "GET:/files",
            xunlei_action("get", "https://example.com/files?foo=bar")
        );
        assert_eq!("POST", xunlei_action("POST", "not-a-url"));
    }

    #[test]
    fn normalize_xunlei_review_url_should_decode_amp_and_complete_scheme() {
        assert_eq!(
            "https://xluser-ssl.xunlei.com/review?foo=bar&baz=qux",
            normalize_xunlei_review_url("https://xluser-ssl.xunlei.com/review?foo=bar&amp;baz=qux")
        );
        assert_eq!(
            "https://xluser-ssl.xunlei.com/review",
            normalize_xunlei_review_url("//xluser-ssl.xunlei.com/review")
        );
        assert_eq!(
            "https://xluser-ssl.xunlei.com/review?key=abc",
            normalize_xunlei_review_url("/review?key=abc")
        );
        assert_eq!(
            "https://example.com/x",
            normalize_xunlei_review_url("  https://example.com/x  ")
        );
    }

    #[test]
    fn extract_xunlei_share_id_should_pull_share_id_or_slash_token() {
        assert_eq!(
            Some("ABC-123_456".to_string()),
            extract_xunlei_share_id("https://pan.xunlei.com/s/ABC-123_456?pwd=xx")
        );
        assert_eq!(
            Some("XYZ789".to_string()),
            extract_xunlei_share_id("https://pan.xunlei.com/share?share_id=XYZ789")
        );
        // The helper only inspects `share_id` / `/s/` markers; a non-xunlei URL
        // lacking both returns None.
        assert_eq!(
            None,
            extract_xunlei_share_id("https://pan.baidu.com/disk/home")
        );
    }

    #[test]
    fn xunlei_credential_round_trip_should_preserve_fields() {
        let mut credential = xunlei_empty_credential("round-trip-seed");
        credential.access_token = "token-XYZ".to_string();
        credential.user_id = "user-42".to_string();
        credential.refresh_token = "refresh-ABC".to_string();
        credential.expires_in = 3600;
        credential.captcha_token = "captcha-T".to_string();

        let storage =
            xunlei_credential_to_storage(&credential).expect("credential should serialize");
        assert!(storage.starts_with("xunlei:token_json:"));

        let parsed = normalize_xunlei_credential(&storage)
            .expect("storage should parse back into credential");
        assert_eq!("token-XYZ", parsed.access_token);
        assert_eq!("user-42", parsed.user_id);
        assert_eq!("refresh-ABC", parsed.refresh_token);
        assert_eq!(3600, parsed.expires_in);
        assert_eq!("captcha-T", parsed.captcha_token);
        assert_eq!("Bearer", parsed.token_type);
        assert_eq!(XUNLEI_CLIENT_ID, parsed.client_id);
        assert_eq!(XUNLEI_CLIENT_SECRET, parsed.client_secret);
        assert_eq!(XUNLEI_CLIENT_VERSION, parsed.client_version);
        assert_eq!(XUNLEI_PACKAGE_NAME, parsed.package_name);
        assert_eq!(XUNLEI_API_BASE, parsed.api_base);
        assert_eq!(credential.device_id, parsed.device_id);
    }

    #[test]
    fn legacy_xunlei_credential_should_parse_bare_token() {
        let credential = legacy_xunlei_credential("  my-token  ");

        assert_eq!("my-token", credential.access_token);
        assert_eq!("Bearer", credential.token_type);
        assert_eq!(XUNLEI_CLIENT_ID, credential.client_id);
        assert_eq!(XUNLEI_CLIENT_SECRET, credential.client_secret);
        assert_eq!(XUNLEI_CLIENT_VERSION, credential.client_version);
        assert_eq!(XUNLEI_PACKAGE_NAME, credential.package_name);
        assert_eq!(XUNLEI_API_BASE, credential.api_base);
        assert!(credential.refresh_token.is_empty());
        assert!(credential.user_id.is_empty());
        assert!(credential.captcha_token.is_empty());
        assert_eq!(0, credential.expires_in);
        // device_id is derived from the raw (untrimmed) input per impl.
        let expected_device_id = format!(
            "{}{}",
            xunlei_hash_hex("  my-token  "),
            xunlei_hash_hex("  my-token  :device")
        );
        assert_eq!(expected_device_id, credential.device_id);
        assert_eq!(32, credential.device_id.len());
    }
}
