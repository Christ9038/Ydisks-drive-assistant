//! 网盘登录捕获：从官方登录窗口采集 Cookie / 设备码令牌，校验登录态，
//! 广播登录完成事件，以及打开各类登录/验证窗口。

pub mod windows;

use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::config::{
    LOGIN_DESKTOP_USER_AGENT, PROVIDER_LOGIN_EVENT, XUNLEI_REVIEW_COMPLETE_EVENT,
    XUNLEI_REVIEW_DONE_PATH, XUNLEI_REVIEW_INIT_SCRIPT, XUNLEI_REVIEW_USER_AGENT,
};
use crate::error::{backend_error, BackendClientError};
use crate::providers::baidu::baidu_account_info;
use crate::providers::provider_name;
use crate::providers::quark::{
    build_quark_cookie_header, capture_quark_login_from_window, quark_account_info,
};
use crate::providers::xunlei::{
    start_xunlei_login, xunlei_account_info, xunlei_credential_to_storage, xunlei_login_sessions,
    xunlei_poll_device_token,
};
use crate::types::{Provider, ProviderLoginResult, ProviderLoginSummary};

use windows::{
    clear_login_capture_flag, mark_login_capture_started, provider_cookie_urls,
    provider_login_success_url, provider_login_url, provider_login_window_label,
    xunlei_review_window_label,
};

/// 登录完成事件负载：携带账号 ID、网盘平台与登录结果，供 `PROVIDER_LOGIN_EVENT` 广播给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderLoginEventPayload {
    account_id: String,
    provider: Provider,
    result: ProviderLoginSummary,
}

/// 迅雷二次验证完成事件负载：携带验证窗口 label（前端据此关闭窗口）与 CreditKey（自动继续登录）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct XunleiReviewCompletePayload {
    /// 触发本次验证的窗口 label，前端据此关闭对应验证窗口。
    window_label: String,
    /// 验证返回的 CreditKey；为空表示验证完成但页面未返回 CreditKey。
    credit_key: String,
}

/// 用凭证调用各网盘账户信息接口，归一化返回登录结果（Cookie / 登录名 / Cookie 数量）。
pub(crate) async fn provider_account_info(
    provider: Provider,
    credential: &str,
) -> Result<ProviderLoginResult, BackendClientError> {
    match provider {
        Provider::Quark => {
            let result = quark_account_info(credential).await?;
            Ok(ProviderLoginResult {
                cookie: result.cookie,
                login_name: result.login_name,
                cookie_count: result.cookie_count,
            })
        }
        Provider::Baidu => baidu_account_info(credential).await,
        Provider::Xunlei => xunlei_account_info(credential).await,
        Provider::Unknown => Err(backend_error("provider", -3, "不支持的网盘平台")),
    }
}

/// 从已打开的登录窗口采集凭证：迅雷走设备码轮询，夸克直接读窗口 Cookie，百度遍历多 URL 拼接 Cookie 后校验。
pub(crate) async fn capture_provider_login(
    app: tauri::AppHandle,
    provider: Provider,
    account_id: String,
) -> Result<ProviderLoginResult, BackendClientError> {
    if provider == Provider::Xunlei {
        let session = {
            let sessions = xunlei_login_sessions()
                .lock()
                .map_err(|_| backend_error("xunlei_token", -7, "迅雷登录会话锁定失败"))?;
            sessions.get(&account_id).cloned()
        }
        .ok_or_else(|| backend_error("xunlei_token", 1002, "请先打开迅雷扫码授权窗口"))?;
        let credential = xunlei_poll_device_token(&session).await?;
        let result = xunlei_account_info(&xunlei_credential_to_storage(&credential)?).await?;
        if let Some(window) =
            app.get_webview_window(&provider_login_window_label(provider, &account_id))
        {
            let _ = window.close();
        }
        return Ok(result);
    }

    let label = provider_login_window_label(provider, &account_id);
    let window = app.get_webview_window(&label).ok_or_else(|| {
        backend_error(
            "provider_login",
            1002,
            format!("请先打开{}官方登录窗口", provider_name(provider)),
        )
    })?;

    if provider == Provider::Quark {
        let result = capture_quark_login_from_window(&window)?;
        let _ = window.close();
        return Ok(ProviderLoginResult {
            cookie: result.cookie,
            login_name: result.login_name,
            cookie_count: result.cookie_count,
        });
    }

    let mut cookies = Vec::new();
    for url in provider_cookie_urls(provider) {
        let mut window_cookies = window.cookies_for_url(url).map_err(|error| {
            backend_error(
                "provider_login",
                -7,
                format!("读取{}登录 Cookie 失败：{error}", provider_name(provider)),
            )
        })?;
        cookies.append(&mut window_cookies);
    }

    let cookie = build_quark_cookie_header(cookies);
    if cookie.is_empty() {
        return Err(backend_error(
            "provider_login",
            1002,
            format!(
                "{}登录未完成，请在官方窗口完成登录后再检测",
                provider_name(provider)
            ),
        ));
    }

    let result = provider_account_info(provider, &cookie).await?;
    let _ = window.close();
    Ok(result)
}

/// 通过 `PROVIDER_LOGIN_EVENT` 向前端广播指定账号的登录完成结果。
pub fn emit_provider_login_complete(
    app: &tauri::AppHandle,
    provider: Provider,
    account_id: String,
    result: ProviderLoginSummary,
) {
    let _ = app.emit(
        PROVIDER_LOGIN_EVENT,
        ProviderLoginEventPayload {
            account_id,
            provider,
            result,
        },
    );
}

/// 监听登录窗口导航：命中成功 URL 后延迟采集凭证，成功则广播事件，失败则清除捕获标志。
pub fn watch_login_navigation(
    app: tauri::AppHandle,
    provider: Provider,
    account_id: String,
    label: String,
    url: &tauri::Url,
) {
    if !provider_login_success_url(provider, url) || !mark_login_capture_started(&label) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(700)).await;
        match capture_provider_login(app.clone(), provider, account_id.clone()).await {
            Ok(result) => {
                let summary = ProviderLoginSummary::from(&result);
                match crate::db::save_login_result(
                    &app,
                    account_id.clone(),
                    result.cookie,
                    result.login_name,
                )
                .await
                {
                    Ok(()) => emit_provider_login_complete(&app, provider, account_id, summary),
                    Err(error) => {
                        tracing::error!(stage=%error.stage, code=error.code, "保存登录凭证失败")
                    }
                }
            }
            Err(_) => clear_login_capture_flag(&label),
        }
    });
}

/// 打开指定网盘的官方登录或授权窗口。
pub(crate) async fn open_provider_login_window(
    app: tauri::AppHandle,
    provider: Provider,
    account_id: String,
) -> Result<(), BackendClientError> {
    let label = provider_login_window_label(provider, &account_id);
    clear_login_capture_flag(&label);

    if provider == Provider::Xunlei {
        let _ = start_xunlei_login(&account_id).await?;
        return Ok(());
    }

    let login_url = provider_login_url(provider).await?;
    let url = tauri::Url::parse(&login_url).map_err(|error| {
        backend_error(
            "provider_login",
            -3,
            format!("{}登录地址无效：{error}", provider_name(provider)),
        )
    })?;

    if let Some(window) = app.get_webview_window(&label) {
        window.navigate(url).map_err(|error| {
            backend_error(
                "provider_login",
                -7,
                format!("打开{}登录页失败：{error}", provider_name(provider)),
            )
        })?;
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let app_for_navigation = app.clone();
    let account_id_for_navigation = account_id.clone();
    let label_for_navigation = label.clone();
    let app_for_new_window = app.clone();
    let label_for_new_window = label.clone();
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
        .user_agent(LOGIN_DESKTOP_USER_AGENT)
        // 登录按钮常通过 window.open / target=_blank 打开登录弹层：在当前窗口内跳转，避免被默认拦截而“点了没反应”。
        .on_new_window(move |new_url, _features| {
            if let Some(window) = app_for_new_window.get_webview_window(&label_for_new_window) {
                let _ = window.navigate(new_url);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .title(format!(
            "{}账号登录 - {account_id}",
            provider_name(provider)
        ))
        .inner_size(980.0, 720.0)
        .center()
        .incognito(true)
        .on_navigation(move |url| {
            watch_login_navigation(
                app_for_navigation.clone(),
                provider,
                account_id_for_navigation.clone(),
                label_for_navigation.clone(),
                url,
            );
            true
        })
        .build()
        .map_err(|error| {
            backend_error(
                "provider_login",
                -7,
                format!("创建{}登录窗口失败：{error}", provider_name(provider)),
            )
        })?;

    Ok(())
}

/// 打开迅雷二次验证页，并注入初始化脚本启动 XlCaptcha。
pub(crate) async fn open_xunlei_review_window(
    app: tauri::AppHandle,
    url: String,
) -> Result<(), BackendClientError> {
    let parsed = tauri::Url::parse(url.trim())
        .map_err(|error| backend_error("xunlei_review", -3, format!("验证页地址无效：{error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(backend_error(
            "xunlei_review",
            -3,
            "只允许打开 http/https 迅雷验证页",
        ));
    }
    let host = parsed.host_str().unwrap_or_default();
    if host != "i.xunlei.com" || !parsed.path().starts_with("/xlcaptcha/") {
        return Err(backend_error(
            "xunlei_review",
            -3,
            "只允许打开迅雷官方验证页",
        ));
    }

    let label = xunlei_review_window_label(parsed.as_str());
    if let Some(window) = app.get_webview_window(&label) {
        window.navigate(parsed).map_err(|error| {
            backend_error("xunlei_review", -7, format!("打开验证页失败：{error}"))
        })?;
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let app_handle = app.clone();
    let done_label = label.clone();
    tauri::WebviewWindowBuilder::new(&app, label.clone(), tauri::WebviewUrl::External(parsed))
        .title("迅雷二次验证")
        .inner_size(420.0, 720.0)
        .center()
        .user_agent(XUNLEI_REVIEW_USER_AGENT)
        .initialization_script(XUNLEI_REVIEW_INIT_SCRIPT)
        .on_navigation(move |url| {
            // 捕获验证完成哨兵：注入脚本在 XlCaptcha 成功后导航到此同源路径回传 CreditKey。
            if url.path() == XUNLEI_REVIEW_DONE_PATH {
                let credit_key = url
                    .query_pairs()
                    .find(|(key, _)| key == "creditkey")
                    .map(|(_, value)| value.to_string())
                    .unwrap_or_default();
                let _ = app_handle.emit(
                    XUNLEI_REVIEW_COMPLETE_EVENT,
                    XunleiReviewCompletePayload {
                        window_label: done_label.clone(),
                        credit_key,
                    },
                );
                // 阻止真正导航到哨兵 URL（它不是有效页面）。
                return false;
            }
            true
        })
        .build()
        .map_err(|error| {
            backend_error("xunlei_review", -7, format!("创建验证窗口失败：{error}"))
        })?;

    Ok(())
}
