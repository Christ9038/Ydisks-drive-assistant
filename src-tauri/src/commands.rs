//! Tauri 命令层：对外暴露的 `#[tauri::command]`，瘦封装调用各业务模块。
//!
//! 21 个原有命令签名与行为保持不变；另新增账号 / 批次 / 历史持久化命令。

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::auth::{
    capture_provider_login, capture_quark_login_cookie, open_provider_login_window,
    open_quark_login_window, open_xunlei_review_window, provider_account_info,
};
use crate::backend::assets::{fetch_backend_assets, fetch_backend_quota};
use crate::backend::links::{
    build_original_link_payload, build_short_link_payloads, create_backend_links,
};
use crate::db::{account_repo, batch_repo, models::AccountRow};
use crate::error::{backend_error, BackendClientError};
use crate::import::parser::{calculate_quota_plan, parse_import_csv, parse_import_text};
use crate::providers::quark::{quark_account_info, transfer_quark_share};
use crate::providers::xunlei::{
    check_xunlei_login_status, start_xunlei_login, xunlei_password_login,
};
use crate::providers::{list_provider_folders, transfer_provider_share};
use crate::types::*;

/// 在阻塞任务中获取数据库连接锁。
async fn with_db<F, T>(app: &AppHandle, stage: &str, f: F) -> Result<T, BackendClientError>
where
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, BackendClientError> + Send + 'static,
    T: Send + 'static,
{
    let stage = stage.to_string();
    let db = crate::db::db(app)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db
            .lock()
            .map_err(|_| backend_error(&stage, -7, "数据库锁定失败"))?;
        f(&mut conn)
    })
    .await
    .map_err(|e| backend_error("db", -7, format!("数据库任务失败：{e}")))?;
    result
}

// === 导入与额度 ===

/// 解析粘贴文本导入资源，委托 `import::parser::parse_import_text`。
#[tauri::command]
pub fn parse_import_text_command(
    provider: Provider,
    account_id: String,
    text: String,
    existing_urls: Vec<String>,
    dedupe_enabled: bool,
) -> ImportParseResult {
    parse_import_text(provider, &account_id, &text, &existing_urls, dedupe_enabled)
}

/// 解析 CSV 文本导入资源，委托 `import::parser::parse_import_csv`。
#[tauri::command]
pub fn parse_import_csv_command(
    provider: Provider,
    account_id: String,
    text: String,
    existing_urls: Vec<String>,
    dedupe_enabled: bool,
) -> ImportParseResult {
    parse_import_csv(provider, &account_id, &text, &existing_urls, dedupe_enabled)
}

/// 构造原始链接创建载荷，委托 `backend::links::build_original_link_payload`。
#[tauri::command]
pub fn build_original_link_payload_command(
    title: String,
    share_url: String,
) -> OriginalLinkCreatePayload {
    build_original_link_payload(&title, &share_url)
}

/// 构造短链创建载荷列表，委托 `backend::links::build_short_link_payloads`。
#[tauri::command]
pub fn build_short_link_payloads_command(
    title: String,
    original_link_id: String,
    targets: Vec<BackendShortLinkTarget>,
) -> Vec<ShortLinkCreatePayload> {
    build_short_link_payloads(&title, &original_link_id, &targets)
}

/// 预览短链额度方案，委托 `import::parser::calculate_quota_plan`。
#[tauri::command]
pub fn preview_quota(
    valid_items: u32,
    selected_channels: u32,
    max_links: u32,
    used_links: u32,
) -> QuotaPlan {
    calculate_quota_plan(valid_items, selected_channels, max_links, used_links)
}

// === 后台 API ===

/// 拉取 Ydisks 账号/渠道/域名等资产，委托 `backend::assets::fetch_backend_assets`。
#[tauri::command]
pub async fn fetch_backend_assets_command(
    api_key: String,
) -> Result<BackendAssetsSnapshot, BackendClientError> {
    fetch_backend_assets(&api_key).await
}

/// 查询短链额度汇总，委托 `backend::assets::fetch_backend_quota`。
#[tauri::command]
pub async fn fetch_backend_quota_command(
    api_key: String,
) -> Result<BackendQuotaSummary, BackendClientError> {
    fetch_backend_quota(&api_key).await
}

/// 注册原始链接并创建短链，委托 `backend::links::create_backend_links`。
#[tauri::command]
pub async fn create_backend_links_command(
    api_key: String,
    account_id: String,
    title: String,
    share_url: String,
    targets: Vec<BackendShortLinkTarget>,
) -> Result<BackendCreationResult, BackendClientError> {
    create_backend_links(&api_key, &account_id, &title, &share_url, &targets).await
}

// === 登录 ===

/// 打开夸克官方登录窗口，委托 `auth::open_quark_login_window`。
#[tauri::command]
pub async fn open_quark_login_window_command(
    app: AppHandle,
    account_id: String,
) -> Result<(), BackendClientError> {
    open_quark_login_window(app, account_id).await
}

/// 从夸克登录窗口采集 Cookie，委托 `auth::capture_quark_login_cookie`。
#[tauri::command]
pub async fn capture_quark_login_cookie_command(
    app: AppHandle,
    account_id: String,
) -> Result<QuarkLoginResult, BackendClientError> {
    capture_quark_login_cookie(app, account_id).await
}

/// 校验夸克 Cookie 有效性并返回账号信息，委托 `providers::quark::quark_account_info`。
#[tauri::command]
pub async fn check_quark_cookie_command(
    cookie: String,
) -> Result<QuarkLoginResult, BackendClientError> {
    quark_account_info(&cookie).await
}

/// 打开指定网盘官方登录窗口，委托 `auth::open_provider_login_window`。
#[tauri::command]
pub async fn open_provider_login_window_command(
    app: AppHandle,
    provider: Provider,
    account_id: String,
) -> Result<(), BackendClientError> {
    open_provider_login_window(app, provider, account_id).await
}

/// 打开迅雷二次验证页，委托 `auth::open_xunlei_review_window`。
#[tauri::command]
pub async fn open_xunlei_review_window_command(
    app: AppHandle,
    url: String,
) -> Result<(), BackendClientError> {
    open_xunlei_review_window(app, url).await
}

/// 关闭指定 label 的迅雷二次验证窗口（验证成功后由前端调用）。
#[tauri::command]
pub async fn close_xunlei_review_window_command(
    app: AppHandle,
    label: String,
) -> Result<(), BackendClientError> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    Ok(())
}

/// 启动迅雷设备码扫码登录，委托 `providers::xunlei::start_xunlei_login`。
#[tauri::command]
pub async fn start_xunlei_login_command(
    account_id: String,
) -> Result<XunleiLoginQrResult, BackendClientError> {
    start_xunlei_login(&account_id).await
}

/// 轮询迅雷登录状态，委托 `providers::xunlei::check_xunlei_login_status`。
#[tauri::command]
pub async fn check_xunlei_login_command(
    account_id: String,
) -> Result<XunleiLoginCheckResult, BackendClientError> {
    check_xunlei_login_status(&account_id).await
}

/// 迅雷账号密码登录（含验证码），委托 `providers::xunlei::xunlei_password_login`。
#[tauri::command]
pub async fn login_xunlei_password_command(
    account_id: String,
    username: String,
    password: String,
    credit_key: String,
) -> Result<ProviderLoginResult, BackendClientError> {
    xunlei_password_login(&account_id, &username, &password, &credit_key).await
}

/// 采集指定网盘登录凭证，委托 `auth::capture_provider_login`。
#[tauri::command]
pub async fn capture_provider_login_command(
    app: AppHandle,
    provider: Provider,
    account_id: String,
) -> Result<ProviderLoginResult, BackendClientError> {
    capture_provider_login(app, provider, account_id).await
}

/// 校验网盘登录凭证并返回账号信息，委托 `auth::provider_account_info`。
#[tauri::command]
pub async fn check_provider_login_command(
    provider: Provider,
    credential: String,
) -> Result<ProviderLoginResult, BackendClientError> {
    provider_account_info(provider, &credential).await
}

// === 目录与转存 ===

/// 列出网盘指定目录下的文件夹，委托 `providers::list_provider_folders`。
#[tauri::command]
pub async fn list_provider_folders_command(
    provider: Provider,
    credential: String,
    folder_ref: String,
) -> Result<Vec<ProviderFolderItem>, BackendClientError> {
    list_provider_folders(provider, &credential, &folder_ref).await
}

/// 转存夸克分享并创建新分享，委托 `providers::quark::transfer_quark_share`。
#[tauri::command]
pub async fn transfer_quark_share_command(
    cookie: String,
    source_url: String,
    target_folder_ref: String,
    title: String,
) -> Result<QuarkTransferResult, BackendClientError> {
    transfer_quark_share(&cookie, &source_url, &target_folder_ref, &title).await
}

/// 通用网盘分享转存，委托 `providers::transfer_provider_share`。
#[tauri::command]
pub async fn transfer_share_command(
    provider: Provider,
    credential: String,
    source_url: String,
    target_folder_ref: String,
    title: String,
) -> Result<ProviderTransferResult, BackendClientError> {
    transfer_provider_share(
        provider,
        &credential,
        &source_url,
        &target_folder_ref,
        &title,
    )
    .await
}

// === 账号持久化（DB） ===

/// 列出所有持久化网盘账号，委托 `db::account_repo::list_accounts`。
#[tauri::command]
pub async fn list_provider_accounts_command(
    app: AppHandle,
) -> Result<Vec<AccountRow>, BackendClientError> {
    with_db(&app, "db", |conn| account_repo::list_accounts(conn)).await
}

/// 新增或更新网盘账号，委托 `db::account_repo::upsert_account`。
#[tauri::command]
pub async fn upsert_provider_account_command(
    app: AppHandle,
    account: AccountRow,
) -> Result<(), BackendClientError> {
    with_db(&app, "db", move |conn| {
        account_repo::upsert_account(conn, &account)
    })
    .await
}

/// 删除指定网盘账号，委托 `db::account_repo::delete_account`。
#[tauri::command]
pub async fn delete_provider_account_command(
    app: AppHandle,
    id: String,
) -> Result<(), BackendClientError> {
    with_db(&app, "db", move |conn| {
        account_repo::delete_account(conn, &id)
    })
    .await
}

/// 一次性迁移：将前端 localStorage 中的账号 JSON 批量导入数据库。
#[tauri::command]
pub async fn import_legacy_accounts_command(
    app: AppHandle,
    json: String,
) -> Result<u32, BackendClientError> {
    let accounts: Vec<AccountRow> = serde_json::from_str(&json)
        .map_err(|e| backend_error("db", -2, format!("解析迁移账号失败：{e}")))?;
    with_db(&app, "db", move |conn| {
        let mut count = 0u32;
        for account in &accounts {
            account_repo::upsert_account(conn, account)?;
            count += 1;
        }
        Ok(count)
    })
    .await
}

// === 批次 / 历史持久化（DB） ===

/// 保存批次记录，委托 `db::batch_repo::save_batch`。
#[tauri::command]
pub async fn save_batch_command(
    app: AppHandle,
    batch: crate::db::models::BatchRow,
) -> Result<(), BackendClientError> {
    with_db(&app, "db", move |conn| batch_repo::save_batch(conn, &batch)).await
}

/// 加载全部批次记录，委托 `db::batch_repo::list_batches`。
#[tauri::command]
pub async fn load_batches_command(
    app: AppHandle,
) -> Result<Vec<crate::db::models::BatchRow>, BackendClientError> {
    with_db(&app, "db", |conn| batch_repo::list_batches(conn)).await
}

/// 删除指定批次记录，委托 `db::batch_repo::delete_batch`。
#[tauri::command]
pub async fn delete_batch_command(app: AppHandle, id: String) -> Result<(), BackendClientError> {
    with_db(&app, "db", move |conn| batch_repo::delete_batch(conn, &id)).await
}

/// 保存历史记录，委托 `db::batch_repo::save_history`。
#[tauri::command]
pub async fn save_history_command(
    app: AppHandle,
    history: crate::db::models::HistoryRow,
) -> Result<(), BackendClientError> {
    with_db(&app, "db", move |conn| {
        batch_repo::save_history(conn, &history)
    })
    .await
}

/// 加载全部历史记录，委托 `db::batch_repo::list_history`。
#[tauri::command]
pub async fn load_history_command(
    app: AppHandle,
) -> Result<Vec<crate::db::models::HistoryRow>, BackendClientError> {
    with_db(&app, "db", |conn| batch_repo::list_history(conn)).await
}

/// 弹出原生「另存为」对话框，让用户选择保存位置后写入文本内容。
///
/// 用于历史记录导出 CSV：避免浏览器 `<a download>` 静默落到下载目录、
/// 用户无法选择路径的问题。返回最终写入的绝对路径；用户取消对话框时返回 `None`。
#[tauri::command]
pub async fn save_text_file_command(
    app: AppHandle,
    file_name: String,
    content: String,
) -> Result<Option<String>, BackendClientError> {
    let file_name = file_name.trim().to_string();
    if file_name.is_empty() {
        return Err(backend_error("save_file", -1, "文件名不能为空"));
    }

    // blocking_save_file 会阻塞当前 runtime 线程直至用户操作完毕，
    // 放到 spawn_blocking 中以免冻结 Tauri 主线程。
    let app_handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app_handle
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("CSV", &["csv"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| backend_error("save_file", -2, format!("保存对话框异常：{e}")))?;

    let Some(picked) = picked else {
        return Ok(None);
    };

    let path = picked
        .into_path()
        .map_err(|e| backend_error("save_file", -3, format!("无效的保存路径：{e}")))?;
    std::fs::write(&path, content.as_bytes())
        .map_err(|e| backend_error("save_file", -4, format!("写入文件失败：{e}")))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

/// 打开应用日志目录（即 tauri-plugin-log 的 `LogDir` 目标所在目录）。
///
/// 通过 `app_log_dir()` 解析路径并确保其存在，再调用系统文件管理器打开。
#[tauri::command]
pub async fn open_log_dir_command(app: AppHandle) -> Result<String, BackendClientError> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| backend_error("log_dir", -1, format!("解析日志目录失败：{e}")))?;

    // 首次运行时日志目录可能尚未被创建，先确保存在再打开。
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| backend_error("log_dir", -2, format!("创建日志目录失败：{e}")))?;
    }

    let path_string = log_dir.to_string_lossy().into_owned();
    open::that(&log_dir)
        .map_err(|e| backend_error("log_dir", -3, format!("打开日志目录失败：{e}")))?;
    Ok(path_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_quota_should_mirror_calculate_quota_plan() {
        let plan = preview_quota(37, 1, 120, 92);
        assert_eq!(
            QuotaPlan {
                valid_items: 37,
                selected_channels: 1,
                required_links: 37,
                remaining_links: 28,
                executable_items: 28,
                waiting_quota_items: 9,
            },
            plan,
        );
    }

    #[test]
    fn preview_quota_should_allow_no_shortlink_channels() {
        let plan = preview_quota(10, 0, 30, 6);
        assert_eq!(0, plan.selected_channels);
        assert_eq!(0, plan.required_links);
        assert_eq!(24, plan.remaining_links);
        assert_eq!(10, plan.executable_items);
        assert_eq!(0, plan.waiting_quota_items);
    }

    #[test]
    fn build_original_link_payload_command_should_trim_fields() {
        let payload = build_original_link_payload_command(
            "  短剧素材包 05  ".to_string(),
            " https://pan.quark.cn/s/new-share ".to_string(),
        );
        assert_eq!("短剧素材包 05", payload.name);
        assert_eq!("https://pan.quark.cn/s/new-share", payload.original_url);
        assert_eq!(None, payload.remark);
    }

    #[test]
    fn build_short_link_payloads_command_should_preserve_order_and_fields() {
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
        let payloads = build_short_link_payloads_command(
            "课程资料".to_string(),
            "original-1".to_string(),
            targets,
        );
        assert_eq!(2, payloads.len(), "one payload per target");
        assert_eq!("channel-1", payloads[0].channel_id, "order preserved");
        assert_eq!("channel-2", payloads[1].channel_id);
        assert_eq!("account-1", payloads[0].account_id);
        assert_eq!("original-1", payloads[0].original_link_id);
        assert_eq!("课程资料", payloads[0].name);
        assert_eq!("t.ydisks.cn", payloads[0].short_domain);
        assert_eq!("INHERIT", payloads[0].pc_qr_mode);
        assert_eq!("INHERIT", payloads[0].extraction_mode);
        assert_eq!(None, payloads[0].extraction_code);
        assert_eq!(None, payloads[0].remark);
    }

    #[test]
    fn parse_import_text_command_should_dedupe_quark_shares() {
        let result = parse_import_text_command(
            Provider::Quark,
            "acc".to_string(),
            "https://pan.quark.cn/s/aaa 标题A\nhttps://pan.quark.cn/s/aaa 标题A重复".to_string(),
            vec![],
            true,
        );
        assert_eq!(1, result.accepted.len(), "duplicate url is deduped");
        assert_eq!(1, result.filtered, "the duplicate row is filtered");
        assert_eq!("https://pan.quark.cn/s/aaa", result.accepted[0].source_url);
    }

    #[test]
    fn parse_import_csv_command_should_skip_header_and_dedupe_rows() {
        let csv = "标题,网盘链接,提取码\n标题A,https://pan.quark.cn/s/aaa,\n标题A,https://pan.quark.cn/s/aaa,";
        let result = parse_import_csv_command(
            Provider::Quark,
            "acc".to_string(),
            csv.to_string(),
            vec![],
            true,
        );
        assert_eq!(1, result.accepted.len(), "one unique quark row accepted");
        assert_eq!(
            2, result.filtered,
            "header + duplicate row are both filtered",
        );
    }
}
