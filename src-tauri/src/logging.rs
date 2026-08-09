//! 日志初始化：基于 tauri-plugin-log（启用 tracing 特性）。
//!
//! 通过 `build_log_plugin()` 在 `run()` 中装配，日志同时输出到控制台、
//! 操作系统日志目录与 Webview 控制台。业务代码统一使用 `tracing::{info,warn,error,debug}!`。

use log::LevelFilter;
use tauri::plugin::TauriPlugin;
use tauri_plugin_log::{Target, TargetKind};

/// 构建日志插件。启用 `tracing` 特性后，`tracing::` 宏的事件会被转发到此处配置的目标。
pub fn build_log_plugin() -> TauriPlugin<tauri::Wry> {
    tauri_plugin_log::Builder::default()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir { file_name: None }),
            Target::new(TargetKind::Webview),
        ])
        .level(LevelFilter::Info)
        .level_for("hyper", LevelFilter::Warn)
        .level_for("reqwest", LevelFilter::Warn)
        .build()
}
