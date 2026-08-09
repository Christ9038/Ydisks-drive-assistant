//! 数据库行模型：与前端 `ProviderAccount` / `BatchRecord` / `HistoryRecord` 对齐。

use serde::{Deserialize, Serialize};

/// 网盘账号持久化行。`credential` 存 Cookie（夸克/百度）或迅雷凭证 JSON。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRow {
    pub id: String,
    pub provider: String,
    pub display_name: String,
    pub status: String,
    pub login_name: String,
    pub purpose: String,
    pub last_checked: String,
    #[serde(default)]
    pub pending_reason: Option<String>,
    #[serde(default)]
    pub credential: Option<String>,
}

/// 批次持久化行。items / logs / short_link_targets 以 JSON 文本列存储。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRow {
    pub id: String,
    pub status: String,
    pub provider: String,
    pub provider_account_id: String,
    pub provider_account_name: String,
    pub ydisks_account_id: String,
    pub ydisks_account_name: String,
    pub target_folder_ref: String,
    pub short_link_target_count: i64,
    pub total: i64,
    pub completed: i64,
    pub current_index: i64,
    pub queue_position: Option<i64>,
    pub retrying: i64,
    pub waiting_quota: i64,
    pub progress: f64,
    pub current_step: String,
    pub local_engine: bool,
    pub items_json: String,
    pub logs_json: String,
    pub short_link_targets_json: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 历史批次持久化行。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: String,
    pub batch_id: String,
    pub status: String,
    pub created_at: String,
    pub total: i64,
    pub completed: i64,
    pub failed: i64,
    pub items_json: String,
    pub logs_json: String,
}
