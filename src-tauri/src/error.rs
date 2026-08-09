//! 统一错误类型与构造工具。
//!
//! `BackendClientError` 直接序列化回传前端，前端按 `{ message, stage, code, details }`
//! 展示并据此触发相应流程（如迅雷 review、登录过期等）。

use std::collections::HashMap;
use std::fmt;

/// 后台 / 网盘 API 错误，直接回传给前端展示。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendClientError {
    pub code: i32,
    pub message: String,
    pub stage: String,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub details: HashMap<String, String>,
}

impl fmt::Display for BackendClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] (code={}) {}", self.stage, self.code, self.message)
    }
}

impl std::error::Error for BackendClientError {}

/// 构造无详情的错误。
pub fn backend_error(stage: &str, code: i32, message: impl Into<String>) -> BackendClientError {
    BackendClientError {
        code,
        message: message.into(),
        stage: stage.to_string(),
        details: HashMap::new(),
    }
}

/// 构造带详情的错误（如迅雷 review 面板所需的 creditKey / reviewUrl 等）。
pub fn backend_error_with_details(
    stage: &str,
    code: i32,
    message: impl Into<String>,
    details: HashMap<String, String>,
) -> BackendClientError {
    BackendClientError {
        code,
        message: message.into(),
        stage: stage.to_string(),
        details,
    }
}
