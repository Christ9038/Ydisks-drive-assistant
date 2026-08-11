//! Ydisks批量转存助手 —— Tauri 后端入口。
//!
//! 本文件仅负责模块声明、插件/状态装配与命令注册。所有业务逻辑分布在
//! `config` / `error` / `types` / `http` / `db` / `backend` / `import` /
//! `providers` / `auth` / `commands` / `logging` 等模块中。

pub mod auth;
pub mod backend;
pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod http;
pub mod import;
pub mod logging;
pub mod providers;
pub mod rate_limit;
pub mod runtime_config;
pub mod types;

use commands::*;

/// 启动 Tauri 应用。
pub fn run() {
    tauri::Builder::default()
        .manage(rate_limit::TransferRateLimiter::default())
        .plugin(logging::build_log_plugin())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            runtime_config::init(app.handle())?;
            db::init_db(app.handle())?;
            tracing::info!("Ydisks批量转存助手启动");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            preview_quota,
            parse_import_text_command,
            parse_import_csv_command,
            build_original_link_payload_command,
            build_short_link_payloads_command,
            fetch_backend_assets_command,
            fetch_backend_quota_command,
            open_provider_login_window_command,
            open_xunlei_review_window_command,
            close_xunlei_review_window_command,
            start_xunlei_login_command,
            check_xunlei_login_command,
            login_xunlei_password_command,
            capture_provider_login_command,
            check_provider_login_command,
            save_provider_credential_command,
            list_provider_folders_command,
            transfer_share_command,
            create_backend_links_command,
            create_original_link_command,
            create_short_link_command,
            list_provider_accounts_command,
            upsert_provider_account_command,
            delete_provider_account_command,
            clear_provider_credential_command,
            import_legacy_accounts_command,
            get_business_settings_command,
            set_transfer_intervals_command,
            configure_backend_api_key_command,
            clear_backend_api_key_command,
            import_legacy_business_settings_command,
            save_batch_command,
            load_batches_command,
            delete_batch_command,
            save_history_command,
            archive_batch_command,
            load_history_command,
            save_text_file_command,
            open_log_dir_command,
            open_console_command,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Ydisks批量转存助手失败");
}
