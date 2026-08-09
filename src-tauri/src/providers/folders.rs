//! 统一目录浏览：按平台列出指定目录下的子文件夹。

use serde_json::Value;

use crate::error::{backend_error, BackendClientError};
use crate::http::client::{as_string, json_error_message, url_with_params};
use crate::providers::baidu::{baidu_get_bdstoken, baidu_list_files};
use crate::providers::quark::{quark_get, quark_params};
use crate::providers::xunlei::{
    normalize_xunlei_credential, xunlei_json_get, xunlei_validate_drive_access, XunleiCredential,
};
use crate::providers::{
    normalize_baidu_folder_ref, normalize_quark_folder_ref, normalize_xunlei_parent_id,
    prefixed_baidu_folder_ref, prefixed_quark_folder_ref, prefixed_xunlei_folder_ref,
};
use crate::types::ProviderFolderItem;

/// 列出夸克指定目录下的子文件夹，仅返回 `dir=true` 的条目，单页最多 500 条。
pub async fn list_quark_folders(
    cookie: &str,
    folder_ref: &str,
) -> Result<Vec<ProviderFolderItem>, BackendClientError> {
    let parent_fid = normalize_quark_folder_ref(folder_ref);
    let mut params = quark_params();
    params.extend([
        ("pdir_fid", parent_fid.clone()),
        ("_page", "1".to_string()),
        ("_size", "500".to_string()),
        ("_fetch_total", "1".to_string()),
        ("_sort", "file_type:asc,updated_at:desc".to_string()),
    ]);
    let url = url_with_params("https://drive-pc.quark.cn/1/clouddrive/file/sort", &params);
    let data = quark_get(cookie, &url, "quark_folders").await?;
    let folders = data
        .get("list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("dir").and_then(Value::as_bool).unwrap_or_default())
        .filter_map(|item| {
            let fid = as_string(item.get("fid"));
            let name = as_string(item.get("file_name"));
            (!fid.is_empty() && !name.is_empty()).then_some(ProviderFolderItem {
                name,
                folder_ref: prefixed_quark_folder_ref(&fid),
                parent_ref: prefixed_quark_folder_ref(&parent_fid),
                is_dir: true,
            })
        })
        .collect();
    Ok(folders)
}

/// 列出百度指定目录下的子文件夹；先取 bdstoken 再调 list 接口，仅返回 `isdir=1` 的条目。Cookie 缺失时返回 `baidu_auth` 错误。
pub async fn list_baidu_folders(
    cookie: &str,
    folder_ref: &str,
) -> Result<Vec<ProviderFolderItem>, BackendClientError> {
    if cookie.trim().is_empty() {
        return Err(backend_error(
            "baidu_auth",
            1001,
            "百度账号缺少 Cookie，请先重新登录",
        ));
    }
    let path = normalize_baidu_folder_ref(folder_ref);
    let bdstoken = baidu_get_bdstoken(cookie).await?;
    let folders = baidu_list_files(cookie, &path, &bdstoken)
        .await?
        .into_iter()
        .filter(|item| {
            item.get("isdir")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                == 1
        })
        .filter_map(|item| {
            let folder_path = as_string(item.get("path"));
            let name = as_string(item.get("server_filename"));
            (!folder_path.is_empty() && !name.is_empty()).then_some(ProviderFolderItem {
                name,
                folder_ref: prefixed_baidu_folder_ref(&folder_path),
                parent_ref: prefixed_baidu_folder_ref(&path),
                is_dir: true,
            })
        })
        .collect();
    Ok(folders)
}

/// 列出迅雷指定目录下的子文件夹。
///
/// 过滤策略与 alist `thunder` 驱动对齐：`phase=PHASE_TYPE_COMPLETE` + `trashed=false`，
/// 即只返回已完成且**未删除**的目录（迅雷接口默认会返回回收站里的目录，必须显式排除，
/// 否则会出现「网盘里只有 4 个文件夹但程序列出一堆」的情况）。
///
/// 先用 `phase=COMPLETE + trashed=false` 请求；若该过滤过严返回空，再回退到仅 `trashed=false`
/// （去掉 phase，避免漏掉非 COMPLETE 的目录），但两种请求都排除回收站。
/// 分页拉取直到 `next_page_token` 为空，单页 100 条。
pub async fn list_xunlei_folders(
    credential: &str,
    folder_ref: &str,
) -> Result<Vec<ProviderFolderItem>, BackendClientError> {
    let mut credential = normalize_xunlei_credential(credential)?;
    let api_base = xunlei_validate_drive_access(&mut credential).await?;
    credential.api_base = api_base;
    let parent_id = normalize_xunlei_parent_id(folder_ref);

    const PHASE_AND_TRASHED: &str =
        r#"{"phase":{"eq":"PHASE_TYPE_COMPLETE"},"trashed":{"eq":false}}"#;
    const TRASHED_ONLY: &str = r#"{"trashed":{"eq":false}}"#;

    let folders = list_xunlei_folder_pages(&mut credential, &parent_id, PHASE_AND_TRASHED).await?;
    if !folders.is_empty() {
        return Ok(folders);
    }
    list_xunlei_folder_pages(&mut credential, &parent_id, TRASHED_ONLY).await
}

/// 分页拉取迅雷目录下的子文件夹：循环请求直到 `next_page_token` 为空，单页 100 条。
///
/// `filters` 为透传给接口的 filters JSON 串（由调用方确保包含 `trashed:false`）。
async fn list_xunlei_folder_pages(
    credential: &mut XunleiCredential,
    parent_id: &str,
    filters: &str,
) -> Result<Vec<ProviderFolderItem>, BackendClientError> {
    let files_url = format!("{}/files", credential.api_base);
    let mut page_token = String::new();
    let mut all_folders = Vec::new();
    loop {
        let params = [
            ("parent_id", parent_id.to_string()),
            ("page_token", page_token.clone()),
            ("limit", "100".to_string()),
            ("with_audit", "true".to_string()),
            ("filters", filters.to_string()),
        ];
        let url = url_with_params(&files_url, &params);
        let data = xunlei_json_get(credential, &url, "xunlei_folders", 30).await?;
        let page_folders = collect_xunlei_folders(&data, parent_id).ok_or_else(|| {
            backend_error(
                "xunlei_folders",
                1002,
                json_error_message(&data, "迅雷目录接口未返回文件列表"),
            )
        })?;
        all_folders.extend(page_folders);
        page_token = as_string(data.get("next_page_token"));
        if page_token.is_empty() {
            break;
        }
    }
    Ok(all_folders)
}

/// 从迅雷 files 接口响应中抽取 `drive#folder` 条目并组装成 `ProviderFolderItem` 列表，无 `files` 数组时返回 `None`。
fn collect_xunlei_folders(data: &Value, parent_id: &str) -> Option<Vec<ProviderFolderItem>> {
    Some(
        data.get("files")?
            .as_array()?
            .iter()
            .filter(|item| as_string(item.get("kind")) == "drive#folder")
            .filter_map(|item| {
                let id = as_string(item.get("id"));
                let name = as_string(item.get("name"));
                (!id.is_empty() && !name.is_empty()).then_some(ProviderFolderItem {
                    name,
                    folder_ref: prefixed_xunlei_folder_ref(&id),
                    parent_ref: prefixed_xunlei_folder_ref(parent_id),
                    is_dir: true,
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_xunlei_folders_should_extract_only_drive_folder_entries() {
        let data = serde_json::json!({
            "files": [
                {"kind": "drive#folder", "id": "folder-1", "name": "电影"},
                {"kind": "drive#folder", "id": "folder-2", "name": "音乐"},
                {"kind": "drive#file", "id": "file-1", "name": "readme.txt"},
                {"kind": "drive#folder", "id": "", "name": "无 ID"},
                {"kind": "drive#folder", "id": "folder-3", "name": ""}
            ]
        });

        let folders = collect_xunlei_folders(&data, "root-parent")
            .expect("valid files array should yield Some(vec)");

        assert_eq!(
            vec![
                ProviderFolderItem {
                    name: "电影".to_string(),
                    folder_ref: "xunlei:parent_id:folder-1".to_string(),
                    parent_ref: "xunlei:parent_id:root-parent".to_string(),
                    is_dir: true,
                },
                ProviderFolderItem {
                    name: "音乐".to_string(),
                    folder_ref: "xunlei:parent_id:folder-2".to_string(),
                    parent_ref: "xunlei:parent_id:root-parent".to_string(),
                    is_dir: true,
                },
            ],
            folders
        );
    }

    #[test]
    fn collect_xunlei_folders_should_return_none_when_files_missing_or_malformed() {
        assert_eq!(None, collect_xunlei_folders(&serde_json::json!({}), "0"));
        assert_eq!(
            None,
            collect_xunlei_folders(&serde_json::json!({"files": "not-an-array"}), "0")
        );
    }

    #[test]
    fn collect_xunlei_folders_should_return_empty_vec_for_blank_files_array() {
        let folders = collect_xunlei_folders(&serde_json::json!({"files": []}), "0")
            .expect("empty files array should still yield Some(empty vec)");
        assert!(folders.is_empty());
    }

    #[test]
    fn collect_xunlei_folders_should_normalize_root_parent_ref() {
        let data = serde_json::json!({
            "files": [
                {"kind": "drive#folder", "id": "child-id", "name": "子目录"}
            ]
        });

        let folders = collect_xunlei_folders(&data, "0").expect("should collect single folder");
        assert_eq!(
            vec![ProviderFolderItem {
                name: "子目录".to_string(),
                folder_ref: "xunlei:parent_id:child-id".to_string(),
                parent_ref: "xunlei:parent_id:0".to_string(),
                is_dir: true,
            }],
            folders
        );
    }
}
