//! 建表 SQL 与基于 `user_version` 的迁移。

/// 初始建表 SQL（user_version 0 → 1）。
pub const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS provider_accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL,
    login_name TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT '',
    last_checked TEXT NOT NULL DEFAULT '',
    pending_reason TEXT,
    credential TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    provider_account_name TEXT NOT NULL,
    ydisks_account_id TEXT NOT NULL,
    ydisks_account_name TEXT NOT NULL,
    target_folder_ref TEXT NOT NULL,
    short_link_target_count INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    current_index INTEGER NOT NULL DEFAULT 0,
    queue_position INTEGER,
    retrying INTEGER NOT NULL DEFAULT 0,
    waiting_quota INTEGER NOT NULL DEFAULT 0,
    progress REAL NOT NULL DEFAULT 0,
    current_step TEXT NOT NULL DEFAULT '',
    local_engine INTEGER NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL DEFAULT '[]',
    logs_json TEXT NOT NULL DEFAULT '[]',
    short_link_targets_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL DEFAULT '[]',
    logs_json TEXT NOT NULL DEFAULT '[]'
);
"#;

/// 当前目标 schema 版本。
pub const CURRENT_VERSION: u32 = 1;
