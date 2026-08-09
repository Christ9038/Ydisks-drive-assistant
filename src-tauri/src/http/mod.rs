//! HTTP 客户端与共享工具。
//!
//! 提供基于 `reqwest` 的单例客户端、各类 JSON/form/text 请求封装，
//! 以及被多个业务模块复用的 URL 编码、Cookie、时间戳与 JSON 取值工具。

pub mod client;
