//! 网盘平台抽象层。
//!
//! 汇总三个网盘（夸克 / 百度 / 迅雷）的转存与目录浏览入口，并提供
//! 统一的目录引用归一化工具。各平台具体业务逻辑见 `quark` / `baidu` / `xunlei`，
//! 目录浏览见 `folders`。

pub mod baidu;
pub mod folders;
pub mod quark;
pub mod xunlei;

use crate::error::{backend_error, BackendClientError};
use crate::types::{Provider, ProviderFolderItem, ProviderTransferResult};

/// 归一化夸克目录引用：去掉 `quark:fid:` 前缀，空值回退为根 `0`。
pub fn normalize_quark_folder_ref(value: &str) -> String {
    let trimmed = value.trim();
    let normalized = trimmed
        .rsplit_once("fid:")
        .map(|(_, fid)| fid)
        .unwrap_or(trimmed)
        .trim();
    if normalized.is_empty() {
        "0".to_string()
    } else {
        normalized.to_string()
    }
}

/// 归一化百度目录引用：去掉 `baidu:path:` 前缀，空值/`0` 回退为根 `/`。
pub fn normalize_baidu_folder_ref(value: &str) -> String {
    let trimmed = value.trim();
    let normalized = trimmed
        .strip_prefix("baidu:path:")
        .unwrap_or(trimmed)
        .trim();
    if normalized.is_empty() || normalized == "0" {
        "/".to_string()
    } else if normalized.starts_with('/') {
        normalized.to_string()
    } else {
        format!("/{normalized}")
    }
}

/// 归一化迅雷父目录 ID：去掉 `xunlei:parent_id:` 前缀，`0` 视为根（返回空）。
pub fn normalize_xunlei_parent_id(value: &str) -> String {
    let trimmed = value.trim();
    let normalized = trimmed
        .strip_prefix("xunlei:parent_id:")
        .unwrap_or(trimmed)
        .trim();
    if normalized == "0" {
        String::new()
    } else {
        normalized.to_string()
    }
}

/// 给夸克目录 fid 拼接 `quark:fid:` 前缀，归一化后作为统一的跨平台目录引用。
pub fn prefixed_quark_folder_ref(fid: &str) -> String {
    format!("quark:fid:{}", normalize_quark_folder_ref(fid))
}

/// 给百度目录 path 拼接 `baidu:path:` 前缀，归一化后作为统一的跨平台目录引用。
pub fn prefixed_baidu_folder_ref(path: &str) -> String {
    format!("baidu:path:{}", normalize_baidu_folder_ref(path))
}

/// 给迅雷父目录 ID 拼接 `xunlei:parent_id:` 前缀，根目录统一记为 `xunlei:parent_id:0`。
pub fn prefixed_xunlei_folder_ref(parent_id: &str) -> String {
    let normalized = normalize_xunlei_parent_id(parent_id);
    if normalized.is_empty() {
        "xunlei:parent_id:0".to_string()
    } else {
        format!("xunlei:parent_id:{normalized}")
    }
}

/// 返回网盘平台的小写英文标识（`quark` / `baidu` / `xunlei` / `unknown`），用于序列化与 localStorage 键名。
pub fn provider_key(provider: Provider) -> &'static str {
    match provider {
        Provider::Quark => "quark",
        Provider::Baidu => "baidu",
        Provider::Xunlei => "xunlei",
        Provider::Unknown => "unknown",
    }
}

/// 返回网盘平台的中文展示名（夸克 / 百度 / 迅雷 / 未知），用于前端提示与日志。
pub fn provider_name(provider: Provider) -> &'static str {
    match provider {
        Provider::Quark => "夸克",
        Provider::Baidu => "百度",
        Provider::Xunlei => "迅雷",
        Provider::Unknown => "未知",
    }
}

/// 按平台分发转存分享链接并生成新的「我的网盘」分享链接。
pub async fn transfer_provider_share(
    provider: Provider,
    credential: &str,
    source_url: &str,
    target_folder_ref: &str,
    title: &str,
) -> Result<ProviderTransferResult, BackendClientError> {
    match provider {
        Provider::Quark => {
            let result =
                quark::transfer_quark_share(credential, source_url, target_folder_ref, title)
                    .await?;
            Ok(ProviderTransferResult {
                share_url: result.share_url,
                saved_fids: result.saved_fids,
                title: result.title,
            })
        }
        Provider::Baidu => {
            baidu::transfer_baidu_share(credential, source_url, target_folder_ref, title).await
        }
        Provider::Xunlei => {
            xunlei::transfer_xunlei_share(credential, source_url, target_folder_ref, title).await
        }
        Provider::Unknown => Err(backend_error("provider", -3, "不支持的网盘平台")),
    }
}

/// 按平台分发目录浏览。
pub async fn list_provider_folders(
    provider: Provider,
    credential: &str,
    folder_ref: &str,
) -> Result<Vec<ProviderFolderItem>, BackendClientError> {
    match provider {
        Provider::Quark => folders::list_quark_folders(credential, folder_ref).await,
        Provider::Baidu => folders::list_baidu_folders(credential, folder_ref).await,
        Provider::Xunlei => folders::list_xunlei_folders(credential, folder_ref).await,
        Provider::Unknown => Err(backend_error("provider", -3, "不支持的网盘平台")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Provider;

    fn block_on_test<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Runtime::new()
            .expect("test tokio runtime should start")
            .block_on(future)
    }

    #[test]
    fn normalize_quark_folder_ref_should_accept_fid_alias() {
        assert_eq!("0", normalize_quark_folder_ref(""));
        assert_eq!("0", normalize_quark_folder_ref("quark:fid:0"));
        assert_eq!("folder_123", normalize_quark_folder_ref("folder_123"));
    }

    #[test]
    fn platform_folder_refs_should_normalize_per_provider() {
        assert_eq!("/", normalize_baidu_folder_ref(""));
        assert_eq!("/", normalize_baidu_folder_ref("baidu:path:/"));
        assert_eq!("/短剧素材", normalize_baidu_folder_ref("短剧素材"));
        assert_eq!("", normalize_xunlei_parent_id("xunlei:parent_id:0"));
        assert_eq!(
            "folder-id",
            normalize_xunlei_parent_id("xunlei:parent_id:folder-id")
        );
    }

    #[test]
    fn prefixed_folder_refs_should_keep_provider_identity() {
        assert_eq!("quark:fid:0", prefixed_quark_folder_ref(""));
        assert_eq!("baidu:path:/素材", prefixed_baidu_folder_ref("素材"));
        assert_eq!("xunlei:parent_id:0", prefixed_xunlei_folder_ref(""));
        assert_eq!(
            "xunlei:parent_id:folder-id",
            prefixed_xunlei_folder_ref("folder-id")
        );
    }

    #[test]
    fn transfer_provider_share_should_reject_missing_platform_credentials() {
        let baidu = block_on_test(transfer_provider_share(
            Provider::Baidu,
            "",
            "https://pan.baidu.com/s/1abcdEFG?pwd=9x8y",
            "baidu:path:/",
            "课程资料",
        ));
        assert_eq!("baidu_auth", baidu.expect_err("missing baidu cookie").stage);

        let xunlei = block_on_test(transfer_provider_share(
            Provider::Xunlei,
            "",
            "https://pan.xunlei.com/s/abcdEFG?pwd=9x8y",
            "xunlei:parent_id:0",
            "课程资料",
        ));
        assert_eq!(
            "xunlei_auth",
            xunlei.expect_err("missing xunlei token").stage
        );
    }
}
