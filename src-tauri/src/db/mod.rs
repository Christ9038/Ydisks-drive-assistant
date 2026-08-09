//! SQLite 数据库：连接管理、迁移与仓储入口。
//!
//! 连接由 `Arc<Mutex<Connection>>` 包裹作为 Tauri 托管状态。命令内克隆 Arc 后
//! 通过 `tauri::async_runtime::spawn_blocking` 调用同步仓储函数，避免阻塞异步运行时。

pub mod account_repo;
pub mod batch_repo;
pub mod models;
pub mod schema;

use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{backend_error, BackendClientError};

/// 托管数据库状态：共享连接 + 互斥锁。
#[derive(Clone)]
pub struct DbState(pub Arc<Mutex<Connection>>);

impl DbState {
    /// 打开（或创建）指定路径的数据库并执行迁移。
    pub fn open(path: &std::path::Path) -> Result<Self, BackendClientError> {
        let conn = Connection::open(path)
            .map_err(|e| backend_error("db", -7, format!("打开数据库失败：{e}")))?;
        migrate(&conn)?;
        Ok(DbState(Arc::new(Mutex::new(conn))))
    }
}

/// 执行迁移：基于 PRAGMA `user_version`。
pub fn migrate(conn: &Connection) -> Result<(), BackendClientError> {
    let current: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| backend_error("db", -7, format!("读取数据库版本失败：{e}")))?;
    if current < schema::CURRENT_VERSION {
        conn.execute_batch(schema::SCHEMA_V1)
            .map_err(|e| backend_error("db", -7, format!("初始化数据库失败：{e}")))?;
        conn.execute_batch(&format!(
            "PRAGMA user_version = {}",
            schema::CURRENT_VERSION
        ))
        .map_err(|e| backend_error("db", -7, format!("写入数据库版本失败：{e}")))?;
        tracing::info!("数据库已迁移到版本 {}", schema::CURRENT_VERSION);
    }
    Ok(())
}

/// 在 Tauri `setup` 中初始化数据库并注入为托管状态。
pub fn init_db(app: &AppHandle) -> Result<(), BackendClientError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| backend_error("db", -7, format!("获取数据目录失败：{e}")))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| backend_error("db", -7, format!("创建数据目录失败：{e}")))?;
    let db_path = data_dir.join("ydisks.db");
    tracing::info!(?db_path, "初始化数据库");
    let state = DbState::open(&db_path)?;
    app.manage(state);
    Ok(())
}

/// 克隆一份共享连接句柄，供 `spawn_blocking` 任务持锁使用。
pub fn db(app: &AppHandle) -> Result<Arc<Mutex<Connection>>, BackendClientError> {
    app.try_state::<DbState>()
        .map(|state| state.0.clone())
        .ok_or_else(|| backend_error("db", -7, "数据库未初始化"))
}

/// live 测试支持：从桌面应用已持久化的 SQLite 中读取已登录账号的 credential，
/// 让 `cargo test -- --ignored` 无需手动复制 cookie 即可直接复用本机已登录态。
#[cfg(test)]
pub(crate) mod testdb {
    use rusqlite::Connection;
    use std::path::PathBuf;

    /// 应用 bundle identifier，与 `tauri.conf.json` 保持一致。
    const APP_IDENTIFIER: &str = "com.ydisks.transfer-assistant";

    /// 解析应用数据库路径：优先读 `YDISKS_DB_PATH` 环境变量，否则按平台数据目录拼接。
    ///
    /// macOS = `~/Library/Application Support/com.ydisks.transfer-assistant/ydisks.db`，
    /// Windows = `%APPDATA%\com.ydisks.transfer-assistant\ydisks.db`，
    /// Linux = `~/.local/share/com.ydisks.transfer-assistant/ydisks.db`，与 Tauri `app_data_dir` 一致。
    pub fn app_db_path() -> Option<PathBuf> {
        if let Ok(custom) = std::env::var("YDISKS_DB_PATH") {
            let path = PathBuf::from(custom);
            return if path.exists() { Some(path) } else { None };
        }
        dirs::data_dir().map(|base| base.join(APP_IDENTIFIER).join("ydisks.db"))
    }

    /// 读取指定平台首个 `connected` 且非空 credential 的账号凭证（cookie/token）。
    /// DB 不存在或无符合条件的账号时返回 `None`。
    pub fn read_connected_credential(provider: &str) -> Option<String> {
        let path = app_db_path()?;
        let conn = Connection::open(path).ok()?;
        let mut stmt = conn
            .prepare(
                "SELECT credential FROM provider_accounts
                 WHERE provider = ?1 AND status = 'connected'
                   AND credential IS NOT NULL AND credential <> ''
                 ORDER BY updated_at DESC LIMIT 1",
            )
            .ok()?;
        let cred: Option<Option<String>> = stmt
            .query_row([provider], |row| row.get::<_, Option<String>>(0))
            .ok();
        cred.flatten().filter(|c| !c.is_empty())
    }
}
