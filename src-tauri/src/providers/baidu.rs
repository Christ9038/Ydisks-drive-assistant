//! 百度网盘业务逻辑：登录态校验、分享验证、转存到指定目录、创建新分享。

use std::collections::HashSet;

use serde_json::Value;

use crate::error::{backend_error, BackendClientError};
use crate::http::client::{
    append_cookie, as_string, extract_query_param, form_encode_pairs, generated_passcode,
    json_scalar_to_string, percent_decode, run_http_form_request, run_http_json_request,
    run_http_text_request, take_url_token_after, url_with_params, EmptyStringFallback,
    EmptyVecFallback,
};
use crate::types::{ProviderLoginResult, ProviderTransferResult};

/// 从百度分享链接中提取 surl：优先取 `surl` 查询参数，否则取 `/s/` 之后的 token。
pub fn extract_baidu_surl(url: &str) -> Option<String> {
    extract_query_param(url, "surl").or_else(|| take_url_token_after(url, "/s/"))
}

/// 构造百度 JSON API 请求头（含 Cookie / Referer / 桌面 Chrome UA）。
fn baidu_headers(cookie: &str, referer: &str) -> Vec<String> {
    vec![
        "Accept: application/json, text/plain, */*".to_string(),
        "Accept-Encoding: identity".to_string(),
        "Accept-Language: zh-CN,zh;q=0.9".to_string(),
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36".to_string(),
        format!("Referer: {referer}"),
        format!("Cookie: {}", cookie.trim()),
    ]
}

/// 构造百度分享页 HTML 请求头（Accept 为 HTML，含 Cookie / Referer）。
fn baidu_page_headers(cookie: &str, referer: &str) -> Vec<String> {
    vec![
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8".to_string(),
        "Accept-Encoding: identity".to_string(),
        "Accept-Language: zh-CN,zh;q=0.9".to_string(),
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36".to_string(),
        format!("Referer: {referer}"),
        format!("Cookie: {}", cookie.trim()),
    ]
}

/// 在 `baidu_headers` 基础上追加表单提交所需的 `Content-Type` 与 `X-Requested-With`。
fn baidu_form_headers(cookie: &str, referer: &str) -> Vec<String> {
    let mut headers = baidu_headers(cookie, referer);
    headers.push("Content-Type: application/x-www-form-urlencoded; charset=UTF-8".to_string());
    headers.push("X-Requested-With: XMLHttpRequest".to_string());
    headers
}

/// 校验百度 Cookie 有效性并返回登录信息：先取账号昵称，再用 quota 接口确认登录态，Cookie 为空或失效时返回 `baidu_auth` 错误。
pub(crate) async fn baidu_account_info(
    cookie: &str,
) -> Result<ProviderLoginResult, BackendClientError> {
    if cookie.trim().is_empty() {
        return Err(backend_error(
            "baidu_auth",
            1001,
            "百度账号缺少 Cookie，请先重新登录",
        ));
    }

    let headers = baidu_headers(cookie, "https://pan.baidu.com/");
    let mut login_name = "百度用户".to_string();
    let uinfo_url =
        "https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&channel=chunlei&web=1&app_id=250528";
    if let Ok(data) = run_http_json_request::<serde_json::Value>(
        "GET",
        uinfo_url,
        &headers,
        None,
        "baidu_account",
        20,
    )
    .await
    {
        if data.get("errno").and_then(Value::as_i64).unwrap_or(-1) == 0 {
            let name = as_string(data.get("baidu_name"));
            if !name.is_empty() {
                login_name = name;
            }
        }
    }

    let quota_url = "https://pan.baidu.com/api/quota?channel=chunlei&web=1&app_id=250528&bdstoken=&clienttype=0";
    let quota = run_http_json_request::<serde_json::Value>(
        "GET",
        quota_url,
        &headers,
        None,
        "baidu_quota",
        20,
    )
    .await?;
    if quota.get("errno").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        return Err(backend_error("baidu_auth", 1002, "百度登录态无效或已过期"));
    }

    Ok(ProviderLoginResult {
        cookie: cookie.trim().to_string(),
        login_name,
        cookie_count: cookie.split(';').filter(|part| part.contains('=')).count(),
    })
}

/// 获取百度 bdstoken，转存与创建分享接口都需要它作为防伪参数；未返回时报 `baidu_bdstoken` 错误。
pub(crate) async fn baidu_get_bdstoken(cookie: &str) -> Result<String, BackendClientError> {
    let headers = baidu_headers(cookie, "https://pan.baidu.com/disk/home");
    let url = "https://pan.baidu.com/api/gettemplatevariable?fields=[%22bdstoken%22]&channel=chunlei&web=1&app_id=250528&bdstoken=null&clienttype=0";
    let data = run_http_json_request::<serde_json::Value>(
        "GET",
        url,
        &headers,
        None,
        "baidu_bdstoken",
        20,
    )
    .await?;
    let token = data
        .get("result")
        .map(|result| as_string(result.get("bdstoken")))
        .unwrap_or_default();
    if token.is_empty() {
        return Err(backend_error("baidu_bdstoken", -4, "百度未返回 bdstoken"));
    }
    Ok(token)
}

/// 列出百度指定目录下的文件元数据（含子目录与文件），`errno` 非 0 时返回空列表。
pub(crate) async fn baidu_list_files(
    cookie: &str,
    path: &str,
    bdstoken: &str,
) -> Result<Vec<Value>, BackendClientError> {
    let headers = baidu_headers(cookie, "https://pan.baidu.com/disk/home");
    let url = url_with_params(
        "https://pan.baidu.com/api/list",
        &[
            ("dir", path.to_string()),
            ("order", "time".to_string()),
            ("desc", "1".to_string()),
            ("limit", "100".to_string()),
            ("web", "1".to_string()),
            ("app_id", "250528".to_string()),
            ("bdstoken", bdstoken.to_string()),
            ("clienttype", "0".to_string()),
            ("channel", "chunlei".to_string()),
        ],
    );
    let data =
        run_http_json_request::<Value>("GET", &url, &headers, None, "baidu_list", 30).await?;
    if data.get("errno").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        return Ok(Vec::new());
    }
    Ok(data
        .get("list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

/// 归一化百度分享链接：补全 `https://pan.baidu.com/s/` 前缀，去掉多余查询参数，并在有提取码时拼接 `?pwd=`。
fn normalize_baidu_share_url(link: &str, pwd: &str) -> String {
    let clean = link.split('?').next().unwrap_or(link).trim();
    let base = if clean.starts_with("http://") || clean.starts_with("https://") {
        clean.to_string()
    } else if clean.starts_with("/s/") {
        format!("https://pan.baidu.com{clean}")
    } else {
        format!("https://pan.baidu.com/s/{}", clean.trim_start_matches('/'))
    };
    if pwd.trim().is_empty() {
        base
    } else {
        format!("{base}?pwd={}", pwd.trim())
    }
}

/// 从百度响应中提取可读错误信息，依次尝试 `errmsg` / `show_msg` / `err_msg`，再回退到带 `errno` 的 `fallback`。
fn baidu_response_error_message(data: &Value, fallback: &str) -> String {
    let message = as_string(data.get("errmsg"))
        .if_empty_then(|| as_string(data.get("show_msg")))
        .if_empty_then(|| as_string(data.get("err_msg")));
    if !message.is_empty() {
        return message;
    }
    let errno = json_scalar_to_string(data.get("errno"));
    if !errno.is_empty() {
        return format!("{fallback}，errno={errno}");
    }
    fallback.to_string()
}

/// 提取分享验证接口返回的 `randsk`（转存时需写入 `BDCLND` Cookie）。
fn baidu_verify_randsk(data: &Value) -> String {
    as_string(data.get("randsk"))
}

#[derive(Debug, Clone)]
struct BaiduShareList {
    file_list: Vec<Value>,
    shareid: String,
    uk: String,
    sekey: String,
}

/// 容错地取出 `data[key]` 数组：直接是数组则返回，否则尝试 `data[key].list`，都没有则返回空。
fn value_array_from(data: &Value, key: &str) -> Vec<Value> {
    data.get(key)
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| {
            data.get(key)
                .and_then(|value| value.get("list"))
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default()
}

/// 从百度分享数据中解析文件列表、shareid、uk、sekey，缺少文件或关键字段时返回 `stage` 错误。
fn baidu_share_list_from_data(
    data: &Value,
    stage: &str,
) -> Result<BaiduShareList, BackendClientError> {
    let file_list = value_array_from(data, "list")
        .if_empty_then(|| value_array_from(data, "file_list"))
        .if_empty_then(|| value_array_from(data, "share_file_list"));
    if file_list.is_empty() {
        return Err(backend_error(stage, -4, "百度分享中没有可转存文件"));
    }

    let first_file = file_list.first();
    let shareid = json_scalar_to_string(data.get("shareid"))
        .if_empty_then(|| json_scalar_to_string(data.get("share_id")))
        .if_empty_then(|| json_scalar_to_string(first_file.and_then(|item| item.get("share_id"))));
    let uk = json_scalar_to_string(data.get("share_uk"))
        .if_empty_then(|| json_scalar_to_string(first_file.and_then(|item| item.get("oper_id"))))
        .if_empty_then(|| json_scalar_to_string(data.get("uk")));
    if shareid.is_empty() || uk.is_empty() {
        return Err(backend_error(stage, -4, "百度分享缺少 shareid 或 uk"));
    }

    Ok(BaiduShareList {
        file_list,
        shareid,
        uk,
        sekey: as_string(data.get("seckey")).if_empty_then(|| as_string(data.get("randsk"))),
    })
}

/// 在 HTML 文本中定位 `prefix` 之后的第一个完整 JSON 对象（支持嵌套与字符串转义），用于解析百度分享页内嵌的 `locals.mset(...)` 数据。
fn extract_json_argument<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let start = text.find(prefix)? + prefix.len();
    let rest = &text[start..];
    let object_start = rest.find('{')?;
    let json = &rest[object_start..];
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in json.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' | '[' => depth += 1,
            '}' | ']' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(&json[..index + ch.len_utf8()]);
                }
            }
            _ => {}
        }
    }
    None
}

/// 构造百度分享页 URL：已是完整链接直接用，否则用 surl + pwd 归一化拼装。
fn baidu_share_page_url(source_url: &str, surl: &str, pwd: &str) -> String {
    let trimmed = source_url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        normalize_baidu_share_url(&format!("1{surl}"), pwd)
    }
}

/// 请求百度分享页 HTML，从 `locals.mset(...)` 中解析文件列表；解析失败或无法访问时报 `baidu_share_page` 错误，sekey 为空时回填验证后的 sekey。
async fn baidu_share_page_list(
    cookie: &str,
    source_url: &str,
    surl: &str,
    pwd: &str,
    verified_sekey: &str,
) -> Result<BaiduShareList, BackendClientError> {
    let page_url = baidu_share_page_url(source_url, surl, pwd);
    let html = run_http_text_request(
        "GET",
        &page_url,
        &baidu_page_headers(cookie, "https://pan.baidu.com/"),
        None,
        "baidu_share_page",
        30,
    )
    .await?;
    let locals = extract_json_argument(&html, "locals.mset(").ok_or_else(|| {
        backend_error(
            "baidu_share_page",
            -4,
            "无法从百度分享页读取文件列表，请确认分享链接可访问",
        )
    })?;
    let data = serde_json::from_str::<Value>(locals).map_err(|error| {
        backend_error(
            "baidu_share_page",
            -2,
            format!("解析百度分享页数据失败：{error}"),
        )
    })?;
    let mut share_list = baidu_share_list_from_data(&data, "baidu_share_page")?;
    if share_list.sekey.is_empty() && !verified_sekey.trim().is_empty() {
        share_list.sekey = verified_sekey.trim().to_string();
    }
    Ok(share_list)
}

/// 通过网页端 `share/list` 接口读取分享根目录文件列表（分享页已不再内嵌 `locals.mset`，此接口更稳定）。
async fn baidu_share_api_list(
    cookie: &str,
    surl: &str,
    verified_sekey: &str,
) -> Result<BaiduShareList, BackendClientError> {
    let url = url_with_params(
        "https://pan.baidu.com/share/list",
        &[
            ("web", "1".to_string()),
            ("app_id", "250528".to_string()),
            ("channel", "chunlei".to_string()),
            ("clienttype", "0".to_string()),
            ("shorturl", surl.to_string()),
            ("root", "1".to_string()),
            ("page", "1".to_string()),
            ("num", "100".to_string()),
        ],
    );
    let data = run_http_json_request::<Value>(
        "GET",
        &url,
        &baidu_headers(cookie, &format!("https://pan.baidu.com/s/1{surl}")),
        None,
        "baidu_share_list",
        30,
    )
    .await?;
    if data.get("errno").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        return Err(backend_error(
            "baidu_share_list",
            -4,
            baidu_response_error_message(&data, "无法读取百度分享文件列表"),
        ));
    }
    let mut share_list = baidu_share_list_from_data(&data, "baidu_share_list")?;
    if share_list.sekey.is_empty() && !verified_sekey.trim().is_empty() {
        share_list.sekey = verified_sekey.trim().to_string();
    }
    Ok(share_list)
}

/// 转存百度分享链接到指定目录，并生成新的百度分享链接。
pub async fn transfer_baidu_share(
    cookie: &str,
    source_url: &str,
    target_folder_ref: &str,
    title: &str,
) -> Result<ProviderTransferResult, BackendClientError> {
    if cookie.trim().is_empty() {
        return Err(backend_error(
            "baidu_auth",
            1001,
            "百度账号缺少 Cookie，请先重新登录",
        ));
    }

    let surl = extract_baidu_surl(source_url)
        .ok_or_else(|| backend_error("baidu_parse", -3, "无法识别百度分享链接"))?;
    let surl_verify = surl.strip_prefix('1').unwrap_or(&surl).to_string();
    let pwd = extract_query_param(source_url, "pwd").unwrap_or_default();
    let share_pwd = if pwd.len() >= 4 {
        pwd.clone()
    } else {
        generated_passcode()
    };
    let mut session_cookie = cookie.trim().to_string();
    let mut verified_sekey = String::new();

    if !pwd.is_empty() {
        let verify_url = url_with_params(
            "https://pan.baidu.com/share/verify",
            &[
                ("surl", surl_verify.clone()),
                ("t", crate::http::client::timestamp_ms().to_string()),
                ("channel", "chunlei".to_string()),
                ("web", "1".to_string()),
                ("app_id", "250528".to_string()),
                ("bdstoken", "".to_string()),
                ("clienttype", "0".to_string()),
            ],
        );
        let form = form_encode_pairs(&[
            ("pwd", pwd.clone()),
            ("vcode", "".to_string()),
            ("vcode_str", "".to_string()),
        ]);
        let data = run_http_form_request(
            "POST",
            &verify_url,
            &baidu_form_headers(
                &session_cookie,
                &format!("https://pan.baidu.com/share/init?surl={surl_verify}"),
            ),
            Some(&form),
            "baidu_verify",
            20,
        )
        .await?;
        if data.get("errno").and_then(Value::as_i64).unwrap_or(-1) != 0 {
            return Err(backend_error(
                "baidu_verify",
                1002,
                baidu_response_error_message(&data, "百度提取码错误或分享已失效"),
            ));
        }
        let randsk = baidu_verify_randsk(&data);
        if randsk.is_empty() {
            return Err(backend_error(
                "baidu_verify",
                1002,
                baidu_response_error_message(&data, "百度验证成功但未返回 randsk"),
            ));
        }
        verified_sekey = percent_decode(&randsk);
        session_cookie = append_cookie(&session_cookie, "BDCLND", &randsk);
    }

    let mut wx_params = vec![
        ("channel", "chunlei".to_string()),
        ("version", "2.0.0".to_string()),
        ("clienttype", "0".to_string()),
        ("web", "1".to_string()),
        ("shorturl", surl_verify.clone()),
        ("dir", "/".to_string()),
        ("root", "1".to_string()),
    ];
    if !pwd.is_empty() {
        wx_params.push(("pwd", pwd.clone()));
    }
    let wx_url = url_with_params("https://pan.baidu.com/share/wxlist", &wx_params);
    let wx_data = run_http_json_request::<serde_json::Value>(
        "GET",
        &wx_url,
        &baidu_headers(
            &session_cookie,
            &format!("https://pan.baidu.com/share/init?surl={surl_verify}"),
        ),
        None,
        "baidu_wxlist",
        30,
    )
    .await?;
    let wx_errno = wx_data.get("errno").and_then(Value::as_i64).unwrap_or(-1);
    let share_list = if wx_errno == 0 {
        let share_data = wx_data
            .get("data")
            .ok_or_else(|| backend_error("baidu_wxlist", -4, "百度未返回分享数据"))?;
        baidu_share_list_from_data(share_data, "baidu_wxlist")?
    } else if wx_errno == 9019 || !pwd.is_empty() {
        match baidu_share_api_list(&session_cookie, &surl_verify, &verified_sekey).await {
            Ok(list) => list,
            Err(api_error) => baidu_share_page_list(
                &session_cookie,
                source_url,
                &surl_verify,
                &pwd,
                &verified_sekey,
            )
            .await
            .map_err(|_| api_error)?,
        }
    } else {
        let wx_errno = wx_data.get("errno").and_then(Value::as_i64).unwrap_or(-1);
        let message = if wx_errno == 9019 {
            if pwd.is_empty() {
                "百度分享需要提取码，请在链接后添加 ?pwd=xxxx，或在 CSV 第三列填写提取码，errno=9019"
                    .to_string()
            } else {
                baidu_response_error_message(
                    &wx_data,
                    "百度提取码验证未生效，请检查提取码或重新登录百度账号",
                )
            }
        } else {
            baidu_response_error_message(&wx_data, "无法读取百度分享文件列表")
        };
        return Err(backend_error("baidu_wxlist", 1002, message));
    };

    let file_list = share_list.file_list;
    let fsids = file_list
        .iter()
        .filter_map(|item| item.get("fs_id").cloned())
        .collect::<Vec<_>>();
    let source_names = file_list
        .iter()
        .map(|item| {
            let server_name = as_string(item.get("server_filename"));
            if server_name.is_empty() {
                as_string(item.get("filename"))
            } else {
                server_name
            }
        })
        .filter(|name| !name.is_empty())
        .collect::<HashSet<_>>();
    if fsids.is_empty() {
        return Err(backend_error("baidu_wxlist", -4, "百度分享文件标识不完整"));
    }

    let shareid = share_list.shareid;
    let uk = share_list.uk;
    let sekey = share_list.sekey;
    let target_path = crate::providers::normalize_baidu_folder_ref(target_folder_ref);
    // 使用标准 Web 端（chunlei）转存接口：它会真正把文件保存到 path 指定目录。
    let bdstoken = baidu_get_bdstoken(&session_cookie).await?;
    let mut transfer_params = vec![
        ("shareid", shareid),
        ("from", uk),
        ("ondup", "newcopy".to_string()),
        ("channel", "chunlei".to_string()),
        ("clienttype", "0".to_string()),
        ("web", "1".to_string()),
        ("app_id", "250528".to_string()),
        ("bdstoken", bdstoken.clone()),
    ];
    if !sekey.is_empty() {
        transfer_params.push(("sekey", sekey));
    }
    let transfer_url = url_with_params("https://pan.baidu.com/share/transfer", &transfer_params);
    // 与百度 Web 端「保存到网盘」一致的请求体：仅 fsidlist + path。
    let transfer_form = form_encode_pairs(&[
        (
            "fsidlist",
            serde_json::to_string(&fsids).unwrap_or_else(|_| "[]".to_string()),
        ),
        ("path", target_path.clone()),
    ]);
    // Referer 必须是分享页（/s/<surl>）而非 /disk/home。
    let transfer_referer = format!("https://pan.baidu.com/s/{surl}");
    let transfer_data = run_http_form_request(
        "POST",
        &transfer_url,
        &baidu_form_headers(&session_cookie, &transfer_referer),
        Some(&transfer_form),
        "baidu_transfer",
        45,
    )
    .await?;
    let transfer_errno = transfer_data
        .get("errno")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    if transfer_errno != 0 && transfer_errno != 200025 {
        let message = as_string(transfer_data.get("show_msg"))
            .if_empty_then(|| as_string(transfer_data.get("err_msg")))
            .if_empty_then(|| format!("errno={transfer_errno}"));
        return Err(backend_error(
            "baidu_transfer",
            transfer_errno as i32,
            message,
        ));
    }

    let mut search_dirs = vec![
        target_path.clone(),
        "/".to_string(),
        "/我的资源".to_string(),
    ];
    search_dirs.dedup();
    let mut share_fids = Vec::new();
    for dir in search_dirs {
        for entry in baidu_list_files(&session_cookie, &dir, &bdstoken).await? {
            let name = as_string(entry.get("server_filename"));
            if source_names.contains(&name) {
                let fs_id = json_scalar_to_string(entry.get("fs_id"));
                if !fs_id.is_empty() && !share_fids.contains(&fs_id) {
                    share_fids.push(fs_id);
                }
            }
        }
        if !share_fids.is_empty() {
            break;
        }
    }
    if share_fids.is_empty() {
        return Err(backend_error(
            "baidu_share",
            -4,
            "百度转存完成，但没有找到已转存文件，稍后重试通常可恢复",
        ));
    }

    let pset_url = url_with_params(
        "https://pan.baidu.com/share/pset",
        &[
            ("channel", "chunlei".to_string()),
            ("bdstoken", bdstoken),
            ("clienttype", "0".to_string()),
            ("app_id", "250528".to_string()),
            ("web", "1".to_string()),
        ],
    );
    let pset_form = form_encode_pairs(&[
        (
            "fid_list",
            serde_json::to_string(&share_fids).unwrap_or_else(|_| "[]".to_string()),
        ),
        ("schannel", "4".to_string()),
        ("channel_list", "[]".to_string()),
        ("period", "0".to_string()),
        ("public", "0".to_string()),
        ("pwd", share_pwd.clone()),
        ("is_knowledge", "0".to_string()),
        ("eflag_disable", "true".to_string()),
        ("linkOrQrcode", "link".to_string()),
    ]);
    let share_response = run_http_form_request(
        "POST",
        &pset_url,
        &baidu_form_headers(&session_cookie, "https://pan.baidu.com/disk/home"),
        Some(&pset_form),
        "baidu_share",
        30,
    )
    .await?;
    if share_response
        .get("errno")
        .and_then(Value::as_i64)
        .unwrap_or(-1)
        != 0
    {
        return Err(backend_error("baidu_share", -4, "百度创建新分享链接失败"));
    }
    let link = as_string(share_response.get("link"))
        .if_empty_then(|| as_string(share_response.get("shorturl")));
    if link.is_empty() {
        return Err(backend_error("baidu_share", -4, "百度未返回新分享链接"));
    }

    Ok(ProviderTransferResult {
        share_url: normalize_baidu_share_url(&link, &share_pwd),
        saved_fids: share_fids,
        title: title.trim().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 在阻塞上下文执行异步 future，供 live 测试复用。
    fn block_on_test<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Runtime::new()
            .expect("test tokio runtime should start")
            .block_on(future)
    }

    #[test]
    fn extract_baidu_surl_should_support_share_urls_and_init_urls() {
        assert_eq!(
            Some("1abcdEFG_123".to_string()),
            extract_baidu_surl("https://pan.baidu.com/s/1abcdEFG_123?pwd=9x8y"),
        );
        assert_eq!(
            Some("abcdEFG_123".to_string()),
            extract_baidu_surl("https://pan.baidu.com/share/init?surl=abcdEFG_123"),
        );
    }

    #[test]
    #[ignore]
    fn live_baidu_account_info_should_succeed() {
        // 优先从桌面应用已登录的 SQLite 账号读取 cookie；也可用环境变量兜底。
        let cookie = crate::db::testdb::read_connected_credential("baidu")
            .or_else(|| std::env::var("YDISKS_LIVE_BAIDU_COOKIE").ok())
            .expect(
                "未找到已登录的百度账号：请在桌面端登录百度账号后重试，或设置 YDISKS_LIVE_BAIDU_COOKIE",
            );

        let result = block_on_test(baidu_account_info(&cookie))
            .expect("百度 account_info 应在已登录 cookie 下成功返回");

        assert!(!result.login_name.is_empty(), "登录名不应为空");
        println!("LIVE_BAIDU_LOGIN_NAME={}", result.login_name);
    }

    #[test]
    #[ignore]
    fn live_baidu_transfer_should_complete() {
        let cookie = crate::db::testdb::read_connected_credential("baidu")
            .or_else(|| std::env::var("YDISKS_LIVE_BAIDU_COOKIE").ok())
            .expect(
                "未找到已登录的百度账号：请在桌面端登录百度账号后重试，或设置 YDISKS_LIVE_BAIDU_COOKIE",
            );
        let source_url =
            std::env::var("YDISKS_LIVE_BAIDU_URL").expect("YDISKS_LIVE_BAIDU_URL is required");
        let target_folder = std::env::var("YDISKS_LIVE_BAIDU_TARGET")
            .unwrap_or_else(|_| "baidu:path:/".to_string());
        let result = block_on_test(transfer_baidu_share(
            &cookie,
            &source_url,
            &target_folder,
            "live-baidu-transfer",
        ))
        .expect("live baidu transfer should succeed");

        assert!(!result.share_url.is_empty());
        println!("LIVE_BAIDU_SHARE_URL={}", result.share_url);
    }

    #[test]
    fn normalize_baidu_share_url_should_canonicalize_link_and_pwd() {
        assert_eq!(
            "https://pan.baidu.com/s/1abcDEF",
            normalize_baidu_share_url("https://pan.baidu.com/s/1abcDEF?pwd=xxxx", "")
        );
        assert_eq!(
            "https://pan.baidu.com/s/1abcDEF?pwd=9x8y",
            normalize_baidu_share_url("https://pan.baidu.com/s/1abcDEF", "9x8y")
        );
        assert_eq!(
            "https://pan.baidu.com/s/1abcDEF?pwd=9x8y",
            normalize_baidu_share_url("/s/1abcDEF", "9x8y")
        );
        assert_eq!(
            "https://pan.baidu.com/s/1abcDEF?pwd=9x8y",
            normalize_baidu_share_url("1abcDEF", " 9x8y ")
        );
        assert_eq!(
            "https://pan.baidu.com/s/1abcDEF",
            normalize_baidu_share_url("  https://pan.baidu.com/s/1abcDEF  ", "")
        );
    }

    #[test]
    fn baidu_share_page_url_should_prefer_full_source_url() {
        assert_eq!(
            "https://pan.baidu.com/s/1abc?pwd=x",
            baidu_share_page_url("https://pan.baidu.com/s/1abc?pwd=x", "1abc", "x")
        );
        // Without a full URL, surl is re-prefixed with "1" and normalized.
        assert_eq!(
            "https://pan.baidu.com/s/1abcDEF?pwd=9x8y",
            baidu_share_page_url("", "abcDEF", "9x8y")
        );
    }

    #[test]
    fn extract_json_argument_should_isolate_first_json_object() {
        assert_eq!(
            Some("{\"a\":1,\"b\":2}"),
            extract_json_argument("locals.mset({\"a\":1,\"b\":2})", "locals.mset(")
        );
        assert_eq!(
            Some("{\"a\":{\"b\":2},\"c\":[1,2]}"),
            extract_json_argument("locals.mset({\"a\":{\"b\":2},\"c\":[1,2]})", "locals.mset(")
        );
        // A closing brace inside a string literal must not terminate the object.
        assert_eq!(
            Some("{\"a\":\"}\"}"),
            extract_json_argument("locals.mset({\"a\":\"}\"})", "locals.mset(")
        );
        assert_eq!(
            None,
            extract_json_argument("no prefix here", "locals.mset(")
        );
        assert_eq!(
            None,
            extract_json_argument("locals.mset() no braces", "locals.mset(")
        );
    }

    #[test]
    fn value_array_from_should_coerce_array_or_nested_list() {
        assert_eq!(
            2,
            value_array_from(&serde_json::json!({"list": [{"a":1},{"b":2}]}), "list").len()
        );
        // When data[key] is an object, fall back to data[key].list.
        assert_eq!(
            1,
            value_array_from(&serde_json::json!({"list": {"list": [{"x":1}]}}), "list").len()
        );
        // null and missing keys yield an empty vec.
        assert!(value_array_from(&serde_json::json!({"list": null}), "list").is_empty());
        assert!(value_array_from(&serde_json::json!({}), "missing").is_empty());
    }

    #[test]
    fn baidu_share_list_from_data_should_parse_file_list_and_keys() {
        let data = serde_json::json!({
            "list": [{
                "fs_id": 123,
                "server_filename": "movie.mp4",
                "share_id": "sh1",
                "oper_id": "op1"
            }],
            "shareid": "share-1",
            "share_uk": "uk-1",
            "seckey": "sec-1"
        });
        let share_list = baidu_share_list_from_data(&data, "baidu_wxlist")
            .expect("valid share data should parse");
        assert_eq!(1, share_list.file_list.len());
        assert_eq!("share-1", share_list.shareid);
        assert_eq!("uk-1", share_list.uk);
        assert_eq!("sec-1", share_list.sekey);
    }

    #[test]
    fn baidu_share_list_from_data_should_fall_back_to_file_fields_and_randsk() {
        let data = serde_json::json!({
            "share_file_list": [{
                "fs_id": 456,
                "share_id": "sh-from-file",
                "oper_id": "op-from-file"
            }],
            "randsk": "rand-1"
        });
        let share_list = baidu_share_list_from_data(&data, "baidu_share_page")
            .expect("fallback fields should parse");
        assert_eq!(1, share_list.file_list.len());
        assert_eq!("sh-from-file", share_list.shareid);
        assert_eq!("op-from-file", share_list.uk);
        assert_eq!("rand-1", share_list.sekey);
    }

    #[test]
    fn baidu_share_list_from_data_should_error_without_files_or_keys() {
        let no_files = baidu_share_list_from_data(
            &serde_json::json!({"shareid": "s1", "share_uk": "u1"}),
            "baidu_wxlist",
        );
        let err = no_files.expect_err("missing file list should error");
        assert_eq!("baidu_wxlist", err.stage);
        assert_eq!(-4, err.code);

        let no_shareid = baidu_share_list_from_data(
            &serde_json::json!({"list": [{"fs_id": 1}]}),
            "baidu_share_page",
        );
        let err = no_shareid.expect_err("missing shareid/uk should error");
        assert_eq!("baidu_share_page", err.stage);
        assert_eq!(-4, err.code);
    }
}
