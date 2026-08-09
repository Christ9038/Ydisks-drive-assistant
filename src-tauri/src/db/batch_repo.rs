//! 批次与历史记录仓储：持久化转存批次（含 items/logs）与已完成历史。

use rusqlite::{params, Connection};

use crate::db::account_repo::now_iso;
use crate::db::models::{BatchRow, HistoryRow};
use crate::error::{backend_error, BackendClientError};

/// 批次表查询 / 映射所用的全部列，按行顺序与 [`row_to_batch`] 的索引一一对应。
const BATCH_COLUMNS: &str = "id, status, provider, provider_account_id, provider_account_name, ydisks_account_id, ydisks_account_name, target_folder_ref, short_link_target_count, total, completed, current_index, queue_position, retrying, waiting_quota, progress, current_step, local_engine, items_json, logs_json, short_link_targets_json, created_at, updated_at";

/// 插入或按 `id` 更新批次（UPSERT），进度/状态/JSON 等字段覆盖写入，`updated_at` 自动刷新。
pub fn save_batch(conn: &Connection, batch: &BatchRow) -> Result<(), BackendClientError> {
    conn.execute(
        "INSERT INTO batches (id, status, provider, provider_account_id, provider_account_name, ydisks_account_id, ydisks_account_name, target_folder_ref, short_link_target_count, total, completed, current_index, queue_position, retrying, waiting_quota, progress, current_step, local_engine, items_json, logs_json, short_link_targets_json, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)
         ON CONFLICT(id) DO UPDATE SET
            status=excluded.status, total=excluded.total, completed=excluded.completed,
            current_index=excluded.current_index, queue_position=excluded.queue_position,
            retrying=excluded.retrying, waiting_quota=excluded.waiting_quota,
            progress=excluded.progress, current_step=excluded.current_step,
            items_json=excluded.items_json, logs_json=excluded.logs_json,
            short_link_targets_json=excluded.short_link_targets_json,
            updated_at=excluded.updated_at",
        params![
            batch.id,
            batch.status,
            batch.provider,
            batch.provider_account_id,
            batch.provider_account_name,
            batch.ydisks_account_id,
            batch.ydisks_account_name,
            batch.target_folder_ref,
            batch.short_link_target_count,
            batch.total,
            batch.completed,
            batch.current_index,
            batch.queue_position,
            batch.retrying,
            batch.waiting_quota,
            batch.progress,
            batch.current_step,
            batch.local_engine as i64,
            batch.items_json,
            batch.logs_json,
            batch.short_link_targets_json,
            batch.created_at,
            now_iso(),
        ],
    )
    .map_err(|e| backend_error("db", -7, format!("保存批次失败：{e}")))?;
    Ok(())
}

/// 读取全部批次，按 `updated_at` 倒序返回。
pub fn list_batches(conn: &Connection) -> Result<Vec<BatchRow>, BackendClientError> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {BATCH_COLUMNS} FROM batches ORDER BY updated_at DESC"
        ))
        .map_err(|e| backend_error("db", -7, format!("读取批次失败：{e}")))?;
    let rows = stmt
        .query_map([], row_to_batch)
        .map_err(|e| backend_error("db", -7, format!("读取批次失败：{e}")))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| backend_error("db", -7, format!("读取批次失败：{e}")))?);
    }
    Ok(out)
}

/// 按 `id` 删除批次。
pub fn delete_batch(conn: &Connection, id: &str) -> Result<(), BackendClientError> {
    conn.execute("DELETE FROM batches WHERE id = ?1", params![id])
        .map_err(|e| backend_error("db", -7, format!("删除批次失败：{e}")))?;
    Ok(())
}

/// 插入或按 `id` 更新历史记录（UPSERT），状态与统计字段覆盖写入。
pub fn save_history(conn: &Connection, history: &HistoryRow) -> Result<(), BackendClientError> {
    conn.execute(
        "INSERT INTO history (id, batch_id, status, created_at, total, completed, failed, items_json, logs_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET
            status=excluded.status, total=excluded.total, completed=excluded.completed,
            failed=excluded.failed, items_json=excluded.items_json, logs_json=excluded.logs_json",
        params![
            history.id,
            history.batch_id,
            history.status,
            history.created_at,
            history.total,
            history.completed,
            history.failed,
            history.items_json,
            history.logs_json,
        ],
    )
    .map_err(|e| backend_error("db", -7, format!("保存历史失败：{e}")))?;
    Ok(())
}

/// 读取全部历史记录，按 `created_at` 倒序返回。
pub fn list_history(conn: &Connection) -> Result<Vec<HistoryRow>, BackendClientError> {
    let mut stmt = conn
        .prepare("SELECT id, batch_id, status, created_at, total, completed, failed, items_json, logs_json FROM history ORDER BY created_at DESC")
        .map_err(|e| backend_error("db", -7, format!("读取历史失败：{e}")))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(HistoryRow {
                id: row.get(0)?,
                batch_id: row.get(1)?,
                status: row.get(2)?,
                created_at: row.get(3)?,
                total: row.get(4)?,
                completed: row.get(5)?,
                failed: row.get(6)?,
                items_json: row.get(7)?,
                logs_json: row.get(8)?,
            })
        })
        .map_err(|e| backend_error("db", -7, format!("读取历史失败：{e}")))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| backend_error("db", -7, format!("读取历史失败：{e}")))?);
    }
    Ok(out)
}

/// 将单行按 [`BATCH_COLUMNS`] 顺序映射为 [`BatchRow`]；`local_engine` 以非 0 整数判定为真。
fn row_to_batch(row: &rusqlite::Row<'_>) -> rusqlite::Result<BatchRow> {
    Ok(BatchRow {
        id: row.get(0)?,
        status: row.get(1)?,
        provider: row.get(2)?,
        provider_account_id: row.get(3)?,
        provider_account_name: row.get(4)?,
        ydisks_account_id: row.get(5)?,
        ydisks_account_name: row.get(6)?,
        target_folder_ref: row.get(7)?,
        short_link_target_count: row.get(8)?,
        total: row.get(9)?,
        completed: row.get(10)?,
        current_index: row.get(11)?,
        queue_position: row.get(12)?,
        retrying: row.get(13)?,
        waiting_quota: row.get(14)?,
        progress: row.get(15)?,
        current_step: row.get(16)?,
        local_engine: row.get::<_, i64>(17)? != 0,
        items_json: row.get(18)?,
        logs_json: row.get(19)?,
        short_link_targets_json: row.get(20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::schema::SCHEMA_V1).unwrap();
        conn
    }

    fn sample_batch(id: &str) -> BatchRow {
        BatchRow {
            id: id.to_string(),
            status: "running".to_string(),
            provider: "quark".to_string(),
            provider_account_id: "acc-1".to_string(),
            provider_account_name: "夸克账号".to_string(),
            ydisks_account_id: "yd-1".to_string(),
            ydisks_account_name: "推广账号".to_string(),
            target_folder_ref: "quark:fid:0".to_string(),
            short_link_target_count: 2,
            total: 10,
            completed: 3,
            current_index: 3,
            queue_position: None,
            retrying: 0,
            waiting_quota: 0,
            progress: 30.0,
            current_step: "转存中".to_string(),
            local_engine: true,
            items_json: "[]".to_string(),
            logs_json: "[]".to_string(),
            short_link_targets_json: "[]".to_string(),
            created_at: now_iso(),
            updated_at: now_iso(),
        }
    }

    #[test]
    fn batch_save_list_delete_should_roundtrip() {
        let conn = mem_conn();
        save_batch(&conn, &sample_batch("b1")).unwrap();
        let mut b = sample_batch("b1");
        b.completed = 10;
        b.status = "done".to_string();
        save_batch(&conn, &b).unwrap();
        let listed = list_batches(&conn).unwrap();
        assert_eq!(1, listed.len());
        assert_eq!(10, listed[0].completed);
        assert_eq!("done", listed[0].status);

        delete_batch(&conn, "b1").unwrap();
        assert!(list_batches(&conn).unwrap().is_empty());
    }

    #[test]
    fn history_save_list_should_roundtrip() {
        let conn = mem_conn();
        let h = HistoryRow {
            id: "h1".to_string(),
            batch_id: "b1".to_string(),
            status: "success".to_string(),
            created_at: now_iso(),
            total: 5,
            completed: 5,
            failed: 0,
            items_json: "[]".to_string(),
            logs_json: "[]".to_string(),
        };
        save_history(&conn, &h).unwrap();
        let listed = list_history(&conn).unwrap();
        assert_eq!(1, listed.len());
        assert_eq!("success", listed[0].status);
    }
}
