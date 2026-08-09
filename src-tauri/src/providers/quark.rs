//! 夸克网盘业务逻辑：登录态采集、目录浏览参数、分享转存、新分享创建。

use std::collections::HashSet;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::error::{backend_error, BackendClientError};
use crate::http::client::{
    as_string, extract_query_param, run_http_request, timestamp_ms, url_with_params,
};
use crate::types::{QuarkLoginResult, QuarkTransferResult};

/// 生成夸克接口参数 `__dt`：60000~299999 区间的伪随机值，用于绕过简单的反爬时间戳校验。
fn quark_dt() -> String {
    let value = 60_000 + (timestamp_ms() % 240_000);
    value.to_string()
}

/// 构造夸克 API 公共查询参数（`pr` / `fr` / `__dt` / `__t` 等），所有夸克接口都需要带上。
pub fn quark_params() -> Vec<(&'static str, String)> {
    vec![
        ("pr", "ucpro".to_string()),
        ("fr", "pc".to_string()),
        ("uc_param_str", "".to_string()),
        ("__dt", quark_dt()),
        ("__t", timestamp_ms().to_string()),
    ]
}

/// 从夸克分享链接中提取 `/s/` 之后的 pwd_id；非夸克域名或无 token 时返回 `None`。
pub fn extract_quark_pwd_id(url: &str) -> Option<String> {
    if !url.to_ascii_lowercase().contains("pan.quark.cn") {
        return None;
    }

    let marker = "/s/";
    let start = url.find(marker)? + marker.len();
    let value = url[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect::<String>();
    (!value.is_empty()).then_some(value)
}

/// 根据账号 ID 生成夸克登录窗口标签（仅保留字母数字与 `-`/`_`，空值回退为 `account`），用于复用同一账号的登录窗口。
pub fn quark_login_window_label(account_id: &str) -> String {
    let safe_id = account_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!(
        "quark-login-{}",
        if safe_id.trim_matches('-').is_empty() {
            "account"
        } else {
            safe_id.trim_matches('-')
        }
    )
}

/// 将 Cookie 列表拼接成 `name=value; name2=value2` 形式的请求头，跳过空名 Cookie，保留原始顺序。
pub(crate) fn build_quark_cookie_header(cookies: Vec<cookie::Cookie<'static>>) -> String {
    cookies
        .into_iter()
        .filter_map(|cookie| {
            let name = cookie.name();
            if name.is_empty() {
                None
            } else {
                Some(format!("{name}={}", cookie.value()))
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// 从 Tauri Cookie 存储中筛选夸克域（`quark.cn`）的 Cookie。
fn quark_cookies_from_store(cookies: Vec<cookie::Cookie<'static>>) -> Vec<cookie::Cookie<'static>> {
    cookies
        .into_iter()
        .filter(|cookie| {
            cookie
                .domain()
                .map(|domain| domain.trim_start_matches('.').ends_with("quark.cn"))
                .unwrap_or(false)
        })
        .collect()
}

/// 从 `name=value; ...` 形式的 Cookie 串中提取所有名称集合。
fn quark_cookie_names(cookie: &str) -> HashSet<String> {
    cookie
        .split(';')
        .filter_map(|part| part.split_once('='))
        .map(|(name, _)| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

/// 判断 Cookie 中是否包含夸克网盘 API 登录态所需的会话 Cookie（`__puus` / `__pus` / `__kps` 等）。
fn quark_has_api_session_cookie(cookie: &str) -> bool {
    let names = quark_cookie_names(cookie);
    ["__puus", "__pus", "__kps", "__kp", "__ktd", "__uid"]
        .iter()
        .any(|name| names.contains(*name))
}

/// 从夸克官方登录窗口采集 Cookie，组装登录态结果。
pub(crate) fn capture_quark_login_from_window(
    window: &tauri::WebviewWindow,
) -> Result<QuarkLoginResult, BackendClientError> {
    let cookies = quark_cookies_from_store(window.cookies().map_err(|error| {
        backend_error(
            "quark_login",
            -7,
            format!("读取夸克登录 Cookie 失败：{error}"),
        )
    })?);

    let cookie = build_quark_cookie_header(cookies);
    if cookie.is_empty() {
        return Err(backend_error(
            "quark_login",
            1002,
            "夸克登录未完成，请在官方窗口完成登录后再检测",
        ));
    }
    if !quark_has_api_session_cookie(&cookie) {
        return Err(backend_error(
            "quark_login",
            1002,
            "已读取到夸克页面 Cookie，但缺少网盘 API 登录态；请在登录窗口刷新并确认进入网盘文件列表",
        ));
    }

    Ok(QuarkLoginResult {
        cookie: cookie.clone(),
        login_name: "夸克已登录账号".to_string(),
        cookie_count: cookie.split(';').filter(|part| part.contains('=')).count(),
    })
}

/// 校验夸克 Cookie 有效性并返回登录信息：先探测网盘根目录确认可用，再依次从 member / account 接口取昵称，Cookie 为空或失效时报 `quark_auth` 错误。
pub(crate) async fn quark_account_info(
    cookie: &str,
) -> Result<QuarkLoginResult, BackendClientError> {
    if cookie.trim().is_empty() {
        return Err(backend_error(
            "quark_auth",
            1001,
            "夸克账号缺少 Cookie，请先重新登录",
        ));
    }

    // 登录态检测要贴近实际功能：能读取网盘根目录，才说明这个 Cookie 可用于目录选择和转存。
    let mut probe_params = quark_params();
    probe_params.extend([
        ("pdir_fid", "0".to_string()),
        ("_page", "1".to_string()),
        ("_size", "1".to_string()),
        ("_fetch_total", "0".to_string()),
        ("_sort", "file_type:asc,updated_at:desc".to_string()),
    ]);
    let probe_url = url_with_params(
        "https://drive-pc.quark.cn/1/clouddrive/file/sort",
        &probe_params,
    );
    let probe_response =
        run_quark_json_request::<serde_json::Value>(cookie, "GET", &probe_url, None, "quark_auth")
            .await?;
    quark_success(probe_response, "quark_auth")?;

    let member_url = url_with_params(
        "https://drive-pc.quark.cn/1/clouddrive/member",
        &quark_params(),
    );
    let member_data = run_quark_json_request::<serde_json::Value>(
        cookie,
        "GET",
        &member_url,
        None,
        "quark_member",
    )
    .await
    .ok()
    .and_then(|response| quark_success(response, "quark_member").ok())
    .unwrap_or(Value::Null);
    let member_info = member_data
        .get("member_info")
        .filter(|value| !value.is_null())
        .unwrap_or(&member_data);

    let account_url = url_with_params(
        "https://pan.quark.cn/account/info",
        &[("fr", "pc".to_string()), ("platform", "pc".to_string())],
    );
    let account_data = run_quark_json_request::<serde_json::Value>(
        cookie,
        "GET",
        &account_url,
        None,
        "quark_account",
    )
    .await
    .ok()
    .and_then(|response| response.get("data").cloned())
    .unwrap_or(Value::Null);
    let login_name = [
        as_string(member_info.get("nickname")),
        as_string(member_info.get("nick_name")),
        as_string(member_info.get("username")),
        as_string(member_info.get("user_name")),
        as_string(member_info.get("mobile")),
        as_string(account_data.get("nickname")),
        as_string(account_data.get("nick_name")),
        as_string(account_data.get("username")),
        as_string(account_data.get("user_name")),
        as_string(account_data.get("mobile")),
    ]
    .into_iter()
    .find(|value| !value.is_empty())
    .unwrap_or_else(|| "夸克已登录账号".to_string());

    Ok(QuarkLoginResult {
        cookie: cookie.to_string(),
        login_name,
        cookie_count: cookie.split(';').filter(|part| part.contains('=')).count(),
    })
}

/// 构造夸克 API 请求头（含 sec-ch-ua / Cookie / Origin / Referer 等桌面 Chrome 浏览器特征）。
fn quark_headers(cookie: &str) -> Vec<String> {
    vec![
        r#"sec-ch-ua: "Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126""#.to_string(),
        "accept: application/json, text/plain, */*".to_string(),
        "content-type: application/json".to_string(),
        "sec-ch-ua-mobile: ?0".to_string(),
        "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36".to_string(),
        r#"sec-ch-ua-platform: "macOS""#.to_string(),
        "origin: https://pan.quark.cn".to_string(),
        "sec-fetch-site: same-site".to_string(),
        "sec-fetch-mode: cors".to_string(),
        "sec-fetch-dest: empty".to_string(),
        "referer: https://pan.quark.cn/".to_string(),
        "accept-language: zh-CN,zh;q=0.9".to_string(),
        format!("cookie: {}", cookie),
    ]
}

/// 执行一次夸克 JSON 请求并返回原始响应；Cookie 为空时直接报 `quark_auth` 错误，不发起网络请求。
async fn run_quark_json_request<T: Serialize>(
    cookie: &str,
    method: &str,
    url: &str,
    body: Option<&T>,
    stage: &str,
) -> Result<Value, BackendClientError> {
    if cookie.trim().is_empty() {
        return Err(backend_error(
            "quark_auth",
            1001,
            "夸克账号缺少 Cookie，请先重新登录",
        ));
    }

    let body = body
        .map(|payload| {
            serde_json::to_vec(payload)
                .map_err(|error| backend_error(stage, -5, format!("序列化夸克请求失败：{error}")))
        })
        .transpose()?;
    run_http_request(method, url, &quark_headers(cookie), body, stage, 60, "夸克").await
}

/// 校验夸克响应是否成功（`status==200` 或 `code==0`），成功返回 `data`，否则按状态码转成错误；401 触发重新登录，41029 带禁止分享恢复时间。
pub fn quark_success(response: Value, stage: &str) -> Result<Value, BackendClientError> {
    let status = response
        .get("status")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let code = response
        .get("code")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let has_code = response.get("code").is_some();
    if status == 200 || (has_code && code == 0) {
        return Ok(response.get("data").cloned().unwrap_or(Value::Null));
    }

    let mut message = as_string(response.get("message"));
    if message.is_empty() {
        message = as_string(response.get("msg"));
    }
    if status == 41029 {
        let forbidden_to = response
            .get("metadata")
            .and_then(|metadata| metadata.get("share_control"))
            .and_then(|share_control| share_control.get("forbidden_to"))
            .map(|value| as_string(Some(value)))
            .unwrap_or_default();
        if !forbidden_to.is_empty() {
            message = if message.is_empty() {
                format!("夸克账号暂时禁止分享，恢复时间：{forbidden_to}")
            } else {
                format!("{message}，恢复时间：{forbidden_to}")
            };
        }
    }
    if message.is_empty() {
        message = "夸克请求失败".to_string();
    }

    let error_code = if status != 0 {
        status as i32
    } else {
        code as i32
    };
    if error_code == 401 || message.contains("401") {
        return Err(backend_error(
            "quark_auth",
            401,
            "夸克登录态已过期，请重新登录",
        ));
    }

    Err(backend_error(stage, error_code, message))
}

/// 执行夸克 POST 请求并自动校验响应（`run_quark_json_request` + `quark_success`）。
async fn quark_post<T: Serialize>(
    cookie: &str,
    url: &str,
    body: &T,
    stage: &str,
) -> Result<Value, BackendClientError> {
    quark_success(
        run_quark_json_request(cookie, "POST", url, Some(body), stage).await?,
        stage,
    )
}

/// 执行夸克 GET 请求并自动校验响应（`run_quark_json_request` + `quark_success`）。
pub(crate) async fn quark_get(
    cookie: &str,
    url: &str,
    stage: &str,
) -> Result<Value, BackendClientError> {
    quark_success(
        run_quark_json_request(cookie, "GET", url, None::<&serde_json::Value>, stage).await?,
        stage,
    )
}

/// 用 pwd_id + 提取码换取夸克分享的 stoken，后续浏览与转存都需要它；未返回时报 `quark_token` 错误。
async fn quark_get_stoken(
    cookie: &str,
    pwd_id: &str,
    passcode: &str,
) -> Result<String, BackendClientError> {
    let url = url_with_params(
        "https://drive-h.quark.cn/1/clouddrive/share/sharepage/token",
        &quark_params(),
    );
    let data = quark_post(
        cookie,
        &url,
        &serde_json::json!({
            "pwd_id": pwd_id,
            "passcode": passcode,
            "support_visit_limit_private_share": true
        }),
        "quark_token",
    )
    .await?;
    let stoken = as_string(data.get("stoken"));
    if stoken.is_empty() {
        return Err(backend_error("quark_token", -4, "夸克未返回 stoken"));
    }
    Ok(stoken)
}

/// 分页拉取夸克分享详情一页（每页 50 条），返回文件列表与是否还有下一页的标记。
async fn quark_detail_page(
    cookie: &str,
    pwd_id: &str,
    stoken: &str,
    page: u32,
    pdir_fid: &str,
) -> Result<(Vec<Value>, bool), BackendClientError> {
    let mut params = quark_params();
    params.extend([
        ("pwd_id", pwd_id.to_string()),
        ("stoken", stoken.to_string()),
        ("pdir_fid", pdir_fid.to_string()),
        ("force", "0".to_string()),
        ("_page", page.to_string()),
        ("_size", "50".to_string()),
        ("_fetch_banner", "1".to_string()),
        ("_fetch_share", "1".to_string()),
        ("_fetch_total", "1".to_string()),
        ("_sort", "file_type:asc,file_name:asc".to_string()),
    ]);
    let url = url_with_params(
        "https://drive-h.quark.cn/1/clouddrive/share/sharepage/detail",
        &params,
    );
    let response =
        run_quark_json_request::<serde_json::Value>(cookie, "GET", &url, None, "quark_detail")
            .await?;
    let status = response
        .get("status")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    if status != 200 {
        return Err(backend_error(
            "quark_detail",
            status as i32,
            as_string(response.get("message")),
        ));
    }
    let list = response
        .get("data")
        .and_then(|data| data.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total = response
        .get("metadata")
        .and_then(|metadata| metadata.get("_total"))
        .and_then(Value::as_u64)
        .unwrap_or(list.len() as u64);
    let have_next = u64::from(page) * 50 < total;
    Ok((list, have_next))
}

/// 翻页拉取夸克分享下的全部文件并合并返回；分享为空时报 `quark_detail` 错误。
async fn quark_share_items(
    cookie: &str,
    pwd_id: &str,
    stoken: &str,
) -> Result<Vec<Value>, BackendClientError> {
    let mut page = 1;
    let mut items = Vec::new();
    loop {
        let (mut list, have_next) = quark_detail_page(cookie, pwd_id, stoken, page, "0").await?;
        items.append(&mut list);
        if !have_next {
            break;
        }
        page += 1;
    }
    if items.is_empty() {
        return Err(backend_error(
            "quark_detail",
            -4,
            "夸克分享链接下没有可转存文件",
        ));
    }
    Ok(items)
}

/// 轮询夸克异步任务（转存 / 创建分享）直到完成，最多等待 60 秒，超时报 `stage` 错误。
async fn quark_poll_task(
    cookie: &str,
    task_id: &str,
    stage: &str,
) -> Result<Value, BackendClientError> {
    // 夸克任务接口返回 data.status 为整数：2 表示成功（0 等待 / 1 处理中 / 2 完成）。
    for retry_index in 0..60 {
        let mut params = quark_params();
        params.extend([
            ("task_id", task_id.to_string()),
            ("retry_index", retry_index.to_string()),
        ]);
        let url = url_with_params("https://drive-pc.quark.cn/1/clouddrive/task", &params);
        let data = quark_get(cookie, &url, stage).await?;
        let task_status = data.get("status").and_then(Value::as_i64);
        let done = matches!(task_status, Some(2))
            || data
                .get("status")
                .and_then(Value::as_bool)
                .unwrap_or_default();
        if done {
            return Ok(data);
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(backend_error(stage, 200, "夸克任务超时"))
}

/// 将夸克分享文件转存到目标目录：提交保存任务并轮询，返回已保存文件的 fid 列表。
async fn quark_save_share(
    cookie: &str,
    pwd_id: &str,
    stoken: &str,
    items: &[Value],
    target_folder_ref: &str,
) -> Result<Vec<String>, BackendClientError> {
    let fid_list = items
        .iter()
        .map(|item| as_string(item.get("fid")))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let fid_token_list = items
        .iter()
        .map(|item| as_string(item.get("share_fid_token")))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if fid_list.is_empty() || fid_list.len() != fid_token_list.len() {
        return Err(backend_error("quark_save", -4, "夸克分享文件标识不完整"));
    }

    let to_pdir_fid = crate::providers::normalize_quark_folder_ref(target_folder_ref);
    let url = url_with_params(
        "https://drive.quark.cn/1/clouddrive/share/sharepage/save",
        &quark_params(),
    );
    let data = quark_post(
        cookie,
        &url,
        &serde_json::json!({
            "fid_list": fid_list,
            "fid_token_list": fid_token_list,
            "to_pdir_fid": to_pdir_fid,
            "pwd_id": pwd_id,
            "stoken": stoken,
            "pdir_fid": 0,
            "scene": "link"
        }),
        "quark_save",
    )
    .await?;
    let task_id = as_string(data.get("task_id"));
    if task_id.is_empty() {
        return Err(backend_error("quark_save", -4, "夸克未返回保存任务 ID"));
    }

    let task = quark_poll_task(cookie, &task_id, "quark_save_task").await?;
    let saved_fids = task
        .get("save_as")
        .and_then(|save_as| save_as.get("save_as_top_fids"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if saved_fids.is_empty() {
        return Err(backend_error(
            "quark_save_task",
            -4,
            "夸克未返回已保存文件 ID",
        ));
    }
    Ok(saved_fids)
}

/// 用已转存的文件创建新的夸克分享：先建分享任务拿到 share_id，再设置提取码并返回 share_url。
async fn quark_create_share(
    cookie: &str,
    saved_fids: &[String],
    title: &str,
) -> Result<String, BackendClientError> {
    let url = url_with_params(
        "https://drive-pc.quark.cn/1/clouddrive/share",
        &quark_params(),
    );
    let data = quark_post(
        cookie,
        &url,
        &serde_json::json!({
            "fid_list": saved_fids,
            "title": title.trim(),
            "url_type": 1,
            "expired_type": 1
        }),
        "quark_share",
    )
    .await?;
    let task_id = as_string(data.get("task_id"));
    if task_id.is_empty() {
        return Err(backend_error("quark_share", -4, "夸克未返回分享任务 ID"));
    }

    let task = quark_poll_task(cookie, &task_id, "quark_share_task").await?;
    let share_id = as_string(task.get("share_id"));
    if share_id.is_empty() {
        return Err(backend_error("quark_share_task", -4, "夸克未返回分享 ID"));
    }

    let password_url = url_with_params(
        "https://drive-pc.quark.cn/1/clouddrive/share/password",
        &quark_params(),
    );
    let data = quark_post(
        cookie,
        &password_url,
        &serde_json::json!({ "share_id": share_id }),
        "quark_share_link",
    )
    .await?;
    let share_url = as_string(data.get("share_url"));
    if share_url.is_empty() {
        return Err(backend_error(
            "quark_share_link",
            -4,
            "夸克未返回新分享链接",
        ));
    }
    Ok(share_url)
}

/// 转存夸克分享链接到指定目录，并生成新的夸克分享链接。
pub async fn transfer_quark_share(
    cookie: &str,
    source_url: &str,
    target_folder_ref: &str,
    title: &str,
) -> Result<QuarkTransferResult, BackendClientError> {
    let pwd_id = extract_quark_pwd_id(source_url)
        .ok_or_else(|| backend_error("quark_parse", -3, "无法识别夸克分享链接"))?;
    let passcode = extract_query_param(source_url, "pwd").unwrap_or_default();
    let stoken = quark_get_stoken(cookie, &pwd_id, &passcode).await?;
    let items = quark_share_items(cookie, &pwd_id, &stoken).await?;
    let saved_fids = quark_save_share(cookie, &pwd_id, &stoken, &items, target_folder_ref).await?;
    let share_url = quark_create_share(cookie, &saved_fids, title).await?;

    Ok(QuarkTransferResult {
        share_url,
        saved_fids,
        title: title.trim().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::BackendClientError;
    use std::collections::HashMap;

    fn block_on_test<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Runtime::new()
            .expect("test tokio runtime should start")
            .block_on(future)
    }

    #[test]
    fn extract_quark_pwd_id_should_only_accept_quark_links() {
        assert_eq!(
            Some("4f63d8c91a7b".to_string()),
            extract_quark_pwd_id("https://pan.quark.cn/s/4f63d8c91a7b?pwd=8391"),
        );
        assert_eq!(
            None,
            extract_quark_pwd_id("https://pan.baidu.com/s/4f63d8c91a7b")
        );
    }

    #[test]
    fn quark_login_window_label_should_be_account_scoped() {
        assert_eq!(
            "quark-login-quark-main",
            quark_login_window_label("quark-main")
        );
        assert_eq!("quark-login-account", quark_login_window_label("  "));
        assert_eq!(
            "quark-login-quark-account-01",
            quark_login_window_label("quark/account 01")
        );
    }

    #[test]
    fn build_quark_cookie_header_should_preserve_browser_order() {
        let cookies = vec![
            cookie::Cookie::build(("kps", "first")).build(),
            cookie::Cookie::build(("empty", "")).build(),
            cookie::Cookie::build(("sign", "abc")).build(),
            cookie::Cookie::build(("kps", "second")).build(),
        ];

        assert_eq!(
            "kps=first; empty=; sign=abc; kps=second",
            build_quark_cookie_header(cookies)
        );
    }

    #[test]
    fn quark_cookies_from_store_should_keep_parent_domain_cookies() {
        let cookies = vec![
            cookie::Cookie::build(("ctoken", "page-token"))
                .domain("pan.quark.cn")
                .build(),
            cookie::Cookie::build(("__kps", "session-a"))
                .domain(".quark.cn")
                .build(),
            cookie::Cookie::build(("other", "value"))
                .domain("example.com")
                .build(),
        ];
        let quark_cookies = quark_cookies_from_store(cookies);

        assert_eq!(
            "ctoken=page-token; __kps=session-a",
            build_quark_cookie_header(quark_cookies)
        );
    }

    #[test]
    fn quark_api_session_cookie_should_reject_page_only_cookie() {
        assert!(!quark_has_api_session_cookie(
            "ctoken=abc; b-user-id=user; grey-id=grey; isQuark=true"
        ));
        assert!(quark_has_api_session_cookie(
            "ctoken=abc; __kps=session; __puus=long-session"
        ));
    }

    #[test]
    fn transfer_quark_share_should_require_cookie_before_network() {
        let result = block_on_test(transfer_quark_share(
            "",
            "https://pan.quark.cn/s/4f63d8c91a7b",
            "quark:fid:0",
            "短剧素材包 05",
        ));

        assert_eq!(
            BackendClientError {
                code: 1001,
                message: "夸克账号缺少 Cookie，请先重新登录".to_string(),
                stage: "quark_auth".to_string(),
                details: HashMap::new(),
            },
            result.expect_err("missing quark cookie should fail before network"),
        );
    }

    #[test]
    fn quark_success_should_report_share_forbidden_until() {
        let result = quark_success(
            serde_json::json!({
                "status": 41029,
                "message": "已被禁止分享",
                "metadata": {
                    "share_control": {
                        "forbidden_to": "2026-06-11 12:00:00"
                    }
                }
            }),
            "quark_share",
        );

        assert_eq!(
            BackendClientError {
                code: 41029,
                message: "已被禁止分享，恢复时间：2026-06-11 12:00:00".to_string(),
                stage: "quark_share".to_string(),
                details: HashMap::new(),
            },
            result.expect_err("share forbidden response should become actionable error"),
        );
    }

    #[test]
    fn quark_success_should_convert_401_to_auth_error() {
        let result = quark_success(
            serde_json::json!({
                "status": 401,
                "message": "Unauthorized"
            }),
            "quark_detail",
        );

        assert_eq!(
            BackendClientError {
                code: 401,
                message: "夸克登录态已过期，请重新登录".to_string(),
                stage: "quark_auth".to_string(),
                details: HashMap::new(),
            },
            result.expect_err("401 should force account relogin"),
        );
    }

    #[test]
    fn quark_params_should_include_required_query_pairs() {
        let params = quark_params();
        let keys: Vec<&str> = params.iter().map(|(k, _)| *k).collect();
        assert_eq!(vec!["pr", "fr", "uc_param_str", "__dt", "__t"], keys);

        let value_of = |key: &str| -> String {
            params
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.clone())
                .unwrap_or_default()
        };
        assert_eq!("ucpro", value_of("pr").as_str());
        assert_eq!("pc", value_of("fr").as_str());
        assert_eq!("", value_of("uc_param_str").as_str());
        // __dt / __t are millisecond-timestamp-derived numeric strings.
        assert!(value_of("__dt").parse::<u64>().is_ok());
        assert!(value_of("__t").parse::<u64>().is_ok());
    }

    #[test]
    fn quark_dt_should_stay_within_pseudo_random_range() {
        let value = quark_dt();
        let numeric = value
            .parse::<u64>()
            .expect("__dt should be a numeric string");

        assert!((60_000..=299_999).contains(&numeric));
        assert!(matches!(value.len(), 5 | 6));
    }

    /// live：用桌面应用已登录的夸克 cookie 验证 account_info（只读，不改动网盘）。
    #[test]
    #[ignore]
    fn live_quark_account_info_should_succeed() {
        let cookie = crate::db::testdb::read_connected_credential("quark")
            .or_else(|| std::env::var("YDISKS_LIVE_QUARK_COOKIE").ok())
            .expect(
                "未找到已登录的夸克账号：请在桌面端登录夸克账号后重试，或设置 YDISKS_LIVE_QUARK_COOKIE",
            );

        let result = block_on_test(quark_account_info(&cookie))
            .expect("夸克 account_info 应在已登录 cookie 下成功返回");

        assert!(!result.login_name.is_empty(), "登录名不应为空");
        assert!(result.cookie_count > 0, "应采集到至少一个 cookie");
        println!("LIVE_QUARK_LOGIN_NAME={}", result.login_name);
    }

    /// live：用已登录夸克 cookie 转存一个真实分享链接（需 env var 提供分享 URL，会写入网盘）。
    #[test]
    #[ignore]
    fn live_quark_transfer_should_complete() {
        let cookie = crate::db::testdb::read_connected_credential("quark")
            .or_else(|| std::env::var("YDISKS_LIVE_QUARK_COOKIE").ok())
            .expect(
                "未找到已登录的夸克账号：请在桌面端登录夸克账号后重试，或设置 YDISKS_LIVE_QUARK_COOKIE",
            );
        let source_url = std::env::var("YDISKS_LIVE_QUARK_URL")
            .expect("YDISKS_LIVE_QUARK_URL is required (提供一个夸克分享链接)");
        let target_folder =
            std::env::var("YDISKS_LIVE_QUARK_TARGET").unwrap_or_else(|_| "quark:fid:0".to_string());

        let result = block_on_test(transfer_quark_share(
            &cookie,
            &source_url,
            &target_folder,
            "live-quark-transfer",
        ))
        .expect("live quark transfer should succeed");

        assert!(!result.share_url.is_empty());
        println!("LIVE_QUARK_SHARE_URL={}", result.share_url);
    }
}
