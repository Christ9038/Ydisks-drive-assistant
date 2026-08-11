//! 敏感设置仓储。SQLite 只保存必须由用户提供的秘密值。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{backend_error, BackendClientError};

pub const DEFAULT_TRANSFER_INTERVAL_SECONDS: u64 = 4;
pub const MINIMUM_TRANSFER_INTERVAL_SECONDS: u64 = 3;
const API_KEY: &str = "backend_api_key";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TransferIntervals {
    pub quark: u64,
    pub baidu: u64,
    pub xunlei: u64,
}

impl Default for TransferIntervals {
    fn default() -> Self {
        Self {
            quark: DEFAULT_TRANSFER_INTERVAL_SECONDS,
            baidu: DEFAULT_TRANSFER_INTERVAL_SECONDS,
            xunlei: DEFAULT_TRANSFER_INTERVAL_SECONDS,
        }
    }
}

impl TransferIntervals {
    pub fn normalized(self) -> Self {
        Self {
            quark: self.quark.max(MINIMUM_TRANSFER_INTERVAL_SECONDS),
            baidu: self.baidu.max(MINIMUM_TRANSFER_INTERVAL_SECONDS),
            xunlei: self.xunlei.max(MINIMUM_TRANSFER_INTERVAL_SECONDS),
        }
    }

    pub fn for_provider(&self, provider: &str) -> u64 {
        match provider {
            "quark" => self.quark,
            "baidu" => self.baidu,
            "xunlei" => self.xunlei,
            _ => DEFAULT_TRANSFER_INTERVAL_SECONDS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessSettings {
    pub transfer_intervals: TransferIntervals,
    pub has_api_key: bool,
}

fn get(conn: &Connection, key: &str) -> Result<Option<String>, BackendClientError> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| backend_error("settings", -7, format!("读取设置失败：{e}")))
}

fn set(conn: &Connection, key: &str, value: &str) -> Result<(), BackendClientError> {
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        params![key, value, super::account_repo::now_iso()],
    )
    .map_err(|e| backend_error("settings", -7, format!("保存设置失败：{e}")))?;
    Ok(())
}

fn set_if_missing(conn: &Connection, key: &str, value: &str) -> Result<(), BackendClientError> {
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
        params![key, value, super::account_repo::now_iso()],
    )
    .map_err(|e| backend_error("settings", -7, format!("迁移设置失败：{e}")))?;
    Ok(())
}

pub fn load_api_key(conn: &Connection) -> Result<String, BackendClientError> {
    Ok(get(conn, API_KEY)?.unwrap_or_default())
}

pub fn save_api_key(conn: &Connection, api_key: &str) -> Result<(), BackendClientError> {
    set(conn, API_KEY, api_key.trim())
}

pub fn clear_api_key(conn: &Connection) -> Result<(), BackendClientError> {
    conn.execute("DELETE FROM app_settings WHERE key = ?1", [API_KEY])
        .map_err(|e| backend_error("settings", -7, format!("清除 API Key 失败：{e}")))?;
    Ok(())
}

pub fn has_api_key(conn: &Connection) -> Result<bool, BackendClientError> {
    Ok(!load_api_key(conn)?.trim().is_empty())
}

/// 一次性导入旧 WebView 密钥。已有后端密钥优先，不会被旧值覆盖。
pub fn import_legacy_api_key(
    conn: &Connection,
    api_key: Option<String>,
) -> Result<bool, BackendClientError> {
    if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
        set_if_missing(conn, API_KEY, key.trim())?;
    }
    has_api_key(conn)
}

/// 从旧版数据库取出转存间隔并删除旧记录，供启动迁移到配置文件。
pub fn take_legacy_transfer_intervals(
    conn: &Connection,
) -> Result<Option<TransferIntervals>, BackendClientError> {
    let value = get(conn, "transfer_intervals")?;
    let parsed = value
        .as_deref()
        .and_then(|json| serde_json::from_str::<TransferIntervals>(json).ok())
        .map(TransferIntervals::normalized);
    if value.is_some() {
        conn.execute(
            "DELETE FROM app_settings WHERE key = 'transfer_intervals'",
            [],
        )
        .map_err(|e| backend_error("settings", -7, format!("清理旧转存间隔失败：{e}")))?;
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::schema::SCHEMA_V1).unwrap();
        conn.execute_batch(crate::db::schema::SCHEMA_V2).unwrap();
        conn
    }

    #[test]
    fn api_key_is_only_exposed_as_presence_in_public_settings() {
        let conn = conn();
        assert!(!has_api_key(&conn).unwrap());
        save_api_key(&conn, " secret ").unwrap();
        assert_eq!(load_api_key(&conn).unwrap(), "secret");
        assert!(has_api_key(&conn).unwrap());
        clear_api_key(&conn).unwrap();
        assert!(!has_api_key(&conn).unwrap());
    }

    #[test]
    fn legacy_import_is_idempotent_and_does_not_override_backend_values() {
        let conn = conn();
        import_legacy_api_key(&conn, Some("old".into())).unwrap();
        assert_eq!(load_api_key(&conn).unwrap(), "old");
        save_api_key(&conn, "new").unwrap();
        import_legacy_api_key(&conn, Some("stale".into())).unwrap();
        assert_eq!(load_api_key(&conn).unwrap(), "new");
    }

    #[test]
    fn legacy_interval_is_taken_once() {
        let conn = conn();
        set(
            &conn,
            "transfer_intervals",
            r#"{"quark":1,"baidu":5,"xunlei":6}"#,
        )
        .unwrap();
        assert_eq!(
            take_legacy_transfer_intervals(&conn)
                .unwrap()
                .unwrap()
                .quark,
            3
        );
        assert!(take_legacy_transfer_intervals(&conn).unwrap().is_none());
    }
}
