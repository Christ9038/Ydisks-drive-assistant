//! 网盘账号仓储：CRUD + 一次性迁移导入。

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::models::AccountRow;
use crate::error::{backend_error, BackendClientError};

/// 读取全部网盘账号，按平台、显示名升序返回。
pub fn list_accounts(conn: &Connection) -> Result<Vec<AccountRow>, BackendClientError> {
    let mut stmt = conn
        .prepare("SELECT id, provider, display_name, status, login_name, purpose, last_checked, pending_reason, credential FROM provider_accounts ORDER BY provider, display_name")
        .map_err(|e| backend_error("db", -7, format!("读取账号失败：{e}")))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AccountRow {
                id: row.get(0)?,
                provider: row.get(1)?,
                display_name: row.get(2)?,
                status: row.get(3)?,
                login_name: row.get(4)?,
                purpose: row.get(5)?,
                last_checked: row.get(6)?,
                pending_reason: row.get(7)?,
                credential: row.get(8)?,
            })
        })
        .map_err(|e| backend_error("db", -7, format!("读取账号失败：{e}")))?;
    let mut accounts = Vec::new();
    for row in rows {
        accounts.push(row.map_err(|e| backend_error("db", -7, format!("读取账号失败：{e}")))?);
    }
    Ok(accounts)
}

/// 插入或按 `id` 更新账号（UPSERT），自动写入 `updated_at` 时间戳。
pub fn upsert_account(conn: &Connection, account: &AccountRow) -> Result<(), BackendClientError> {
    conn.execute(
        "INSERT INTO provider_accounts (id, provider, display_name, status, login_name, purpose, last_checked, pending_reason, credential, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
            provider=excluded.provider,
            display_name=excluded.display_name,
            status=excluded.status,
            login_name=excluded.login_name,
            purpose=excluded.purpose,
            last_checked=excluded.last_checked,
            pending_reason=excluded.pending_reason,
            credential=excluded.credential,
            updated_at=excluded.updated_at",
        params![
            account.id,
            account.provider,
            account.display_name,
            account.status,
            account.login_name,
            account.purpose,
            account.last_checked,
            account.pending_reason,
            account.credential,
            now_iso(),
            now_iso(),
        ],
    )
    .map_err(|e| backend_error("db", -7, format!("保存账号失败：{e}")))?;
    Ok(())
}

/// 按 `id` 删除账号。
pub fn delete_account(conn: &Connection, id: &str) -> Result<(), BackendClientError> {
    conn.execute("DELETE FROM provider_accounts WHERE id = ?1", params![id])
        .map_err(|e| backend_error("db", -7, format!("删除账号失败：{e}")))?;
    Ok(())
}

/// 按 `id` 查询单个账号，不存在时返回 `Ok(None)`。
pub fn find_account(conn: &Connection, id: &str) -> Result<Option<AccountRow>, BackendClientError> {
    conn.query_row(
        "SELECT id, provider, display_name, status, login_name, purpose, last_checked, pending_reason, credential FROM provider_accounts WHERE id = ?1",
        params![id],
        |row| {
            Ok(AccountRow {
                id: row.get(0)?,
                provider: row.get(1)?,
                display_name: row.get(2)?,
                status: row.get(3)?,
                login_name: row.get(4)?,
                purpose: row.get(5)?,
                last_checked: row.get(6)?,
                pending_reason: row.get(7)?,
                credential: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|e| backend_error("db", -7, format!("查询账号失败：{e}")))
}

/// 当前 UTC 时间的 RFC 3339 字符串，用作 `created_at` / `updated_at` 时间戳。
pub(crate) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::schema::SCHEMA_V1).unwrap();
        conn
    }

    #[test]
    fn account_upsert_list_delete_should_roundtrip() {
        let conn = mem_conn();
        let account = AccountRow {
            id: "quark-1".to_string(),
            provider: "quark".to_string(),
            display_name: "夸克主账号".to_string(),
            status: "connected".to_string(),
            login_name: "用户A".to_string(),
            purpose: "".to_string(),
            last_checked: "-".to_string(),
            pending_reason: None,
            credential: Some("cookie-abc".to_string()),
        };
        upsert_account(&conn, &account).unwrap();
        let listed = list_accounts(&conn).unwrap();
        assert_eq!(1, listed.len());
        assert_eq!("cookie-abc", listed[0].credential.as_deref().unwrap());

        // update path
        let mut updated = account.clone();
        updated.status = "expired".to_string();
        upsert_account(&conn, &updated).unwrap();
        assert_eq!(
            "expired",
            find_account(&conn, "quark-1").unwrap().unwrap().status
        );

        delete_account(&conn, "quark-1").unwrap();
        assert!(list_accounts(&conn).unwrap().is_empty());
    }

    #[test]
    fn now_iso_should_be_rfc3339_parseable_utc_timestamp() {
        let stamp = now_iso();
        assert!(
            stamp.contains('T'),
            "RFC3339 date/time separator T present, got {stamp}",
        );
        let is_utc = stamp.ends_with('Z') || stamp.ends_with("+00:00");
        assert!(
            is_utc,
            "stamp should carry a UTC indicator (Z or +00:00), got {stamp}"
        );
        assert!(
            chrono::DateTime::parse_from_rfc3339(&stamp).is_ok(),
            "stamp must be RFC3339 parseable, got {stamp}",
        );
    }
}
