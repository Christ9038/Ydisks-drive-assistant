//! Ydisks 控制台后台 API 客户端。
//!
//! - `client`：HTTP 调用与信封解析（`{ code, message, data }`）。
//! - `assets`：拉取配额 / 账号 / 渠道 / 域名。
//! - `links`：创建原始链接与短链。

pub mod assets;
pub mod client;
pub mod links;
