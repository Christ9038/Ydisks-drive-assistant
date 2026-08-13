// Release builds are GUI applications on Windows; do not attach a console
// window to the Tauri process. Debug builds keep the console for diagnostics.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 二进制入口：委托 `ydisks_transfer_assistant_lib::run()` 启动 Tauri 应用。
fn main() {
    ydisks_transfer_assistant_lib::run();
}
