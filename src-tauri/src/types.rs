//! 领域类型：网盘平台、导入解析、后台资产、转存/登录结果、目录浏览项。
//!
//! 这些类型在多个模块间流转（命令层、provider 业务层、backend API 层），
//! 集中定义以避免循环依赖。仅与 Rust 内部逻辑相关的私有辅助类型仍留在各自模块。

use serde::{Deserialize, Serialize};

/// 网盘平台枚举。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    /// 夸克网盘。
    Quark,
    /// 百度网盘。
    Baidu,
    /// 迅雷网盘。
    Xunlei,
    /// 未识别平台。
    Unknown,
}

/// 额度预检结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QuotaPlan {
    /// 有效输入数量。
    pub valid_items: u32,
    /// 已选短链渠道数量。
    pub selected_channels: u32,
    /// 本次全部资源需要创建的短链数量。
    pub required_links: u32,
    /// 当前短链剩余额度。
    pub remaining_links: u32,
    /// 本次可执行数量。
    pub executable_items: u32,
    /// 因额度不足等待的数量。
    pub waiting_quota_items: u32,
}

/// Rust 侧解析出的导入资源。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ParsedImportResource {
    /// 资源标题。
    pub title: String,
    /// 原分享链接。
    pub source_url: String,
    /// 识别出的平台。
    pub provider: Provider,
}

/// 导入解析结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportParseResult {
    /// 可加入导入清单的资源。
    pub accepted: Vec<ParsedImportResource>,
    /// 被过滤的行数，包含平台不符、无法识别、重复或无链接。
    pub filtered: u32,
}

/// 后台原始链接创建 payload。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct OriginalLinkCreatePayload {
    pub name: String,
    pub original_url: String,
    pub remark: Option<String>,
}

/// 前端选择的单个短链目标。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendShortLinkTarget {
    pub account_id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub domain: String,
}

/// 后台短链创建 payload。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct ShortLinkCreatePayload {
    pub account_id: String,
    pub channel_id: String,
    pub original_link_id: String,
    pub name: String,
    pub remark: Option<String>,
    pub short_domain: String,
    pub expire_at: Option<String>,
    pub pc_qr_mode: String,
    pub extraction_mode: String,
    pub extraction_code: Option<String>,
    pub extraction_hint: Option<String>,
}

/// 后台创建接口返回的短链结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendShortLinkResult {
    pub channel_id: String,
    pub channel_name: String,
    pub domain: String,
    pub short_url: String,
}

/// 单条资源完成后台登记后的结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCreationResult {
    pub original_link_id: String,
    pub short_links: Vec<BackendShortLinkResult>,
}

/// 后台短链配额摘要。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendQuotaSummary {
    pub max_links: u32,
    pub used_links: u32,
    pub remaining_links: u32,
    pub shortlink_access_status: String,
}

/// 后台推广账号选项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAccountOption {
    pub id: String,
    pub name: String,
    /// 推广账号类型名称，例如 "夸克网盘"，用于按网盘平台筛选账号。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_type_name: Option<String>,
}

/// 后台渠道选项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendChannelOption {
    pub id: String,
    pub name: String,
}

/// 后台域名选项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendDomainOption {
    pub domain_name: String,
    pub status: String,
}

/// API Key 检测后拉取到的后台资产。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAssetsSnapshot {
    pub quota: BackendQuotaSummary,
    pub accounts: Vec<BackendAccountOption>,
    pub channels: Vec<BackendChannelOption>,
    pub domains: Vec<BackendDomainOption>,
}

/// 夸克转存后的分享结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarkTransferResult {
    pub share_url: String,
    pub saved_fids: Vec<String>,
    pub title: String,
}

/// 夸克官方登录窗口采集到的登录态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarkLoginResult {
    pub cookie: String,
    pub login_name: String,
    pub cookie_count: usize,
}

/// 通用网盘登录结果。字段名沿用 cookie，迅雷场景下存放 access token。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLoginResult {
    pub cookie: String,
    pub login_name: String,
    pub cookie_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XunleiLoginQrResult {
    pub user_code: String,
    pub qrcode_svg: String,
    pub qrcode_url: String,
    pub expires_in: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XunleiLoginCheckResult {
    pub status: String,
    pub result: Option<ProviderLoginResult>,
}

/// 通用网盘转存结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransferResult {
    pub share_url: String,
    pub saved_fids: Vec<String>,
    pub title: String,
}

/// 统一目录浏览返回项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFolderItem {
    pub name: String,
    pub folder_ref: String,
    pub parent_ref: String,
    pub is_dir: bool,
}
