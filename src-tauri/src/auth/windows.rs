//! 登录窗口相关：窗口标签、Cookie 采集 URL、登录成功判定、登录页地址。

use std::sync::Mutex;

use crate::config::{BAIDU_LOGIN_URL, QUARK_LOGIN_URL};
use crate::error::{backend_error, BackendClientError};
use crate::http::client::login_capture_in_progress;
use crate::providers::{provider_key, xunlei::xunlei_hash_hex};
use crate::types::Provider;

/// 生成网盘登录窗口标签：`{provider}-login-{account_id}`，非字母数字字符替换为 `-`。
pub fn provider_login_window_label(provider: Provider, account_id: &str) -> String {
    let safe_id = account_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!(
        "{}-login-{}",
        provider_key(provider),
        if safe_id.trim_matches('-').is_empty() {
            "account"
        } else {
            safe_id.trim_matches('-')
        }
    )
}

/// 生成迅雷二次验证窗口标签：`xunlei-review-{url哈希}`。
pub fn xunlei_review_window_label(url: &str) -> String {
    format!("xunlei-review-{}", xunlei_hash_hex(url))
}

/// 返回指定网盘采集 Cookie 时需要遍历的 URL 列表（夸克覆盖多子域，百度覆盖主站）。
pub fn provider_cookie_urls(provider: Provider) -> Vec<tauri::Url> {
    let urls: &[&str] = match provider {
        Provider::Quark => &[
            "https://pan.quark.cn/",
            "https://pan.quark.cn/list",
            "https://drive-pc.quark.cn/",
            "https://drive-pc.quark.cn/1/clouddrive/file/sort",
            "https://drive-pc.quark.cn/1/clouddrive/member",
            "https://drive-pc.quark.cn/1/clouddrive/task",
            "https://drive-pc.quark.cn/1/clouddrive/share/password",
            "https://drive.quark.cn/",
            "https://drive.quark.cn/1/clouddrive/share/sharepage/save",
            "https://drive-h.quark.cn/",
            "https://drive-h.quark.cn/1/clouddrive/share/sharepage/token",
            "https://drive-h.quark.cn/1/clouddrive/share/sharepage/detail",
        ],
        Provider::Baidu => &[
            "https://pan.baidu.com/",
            "https://www.baidu.com/",
            "https://baidu.com/",
        ],
        _ => &[],
    };
    urls.iter()
        .filter_map(|url| tauri::Url::parse(url).ok())
        .collect()
}

/// 判断导航 URL 是否表示该网盘登录成功（夸克命中 `/list`，百度命中 `/disk/` 或 `/mbox/`）。
pub fn provider_login_success_url(provider: Provider, url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    let path = url.path();
    let full_url = url.as_str();
    match provider {
        Provider::Quark => {
            host.ends_with("pan.quark.cn")
                && (path.starts_with("/list") || full_url.contains("#/list"))
        }
        Provider::Baidu => {
            host.ends_with("pan.baidu.com")
                && (path.starts_with("/disk/") || path.starts_with("/mbox/"))
        }
        _ => false,
    }
}

/// 返回指定网盘官方登录页地址；迅雷使用 `about:blank` 占位（走设备码流程）。
pub async fn provider_login_url(provider: Provider) -> Result<String, BackendClientError> {
    match provider {
        Provider::Quark => Ok(QUARK_LOGIN_URL.to_string()),
        Provider::Baidu => Ok(BAIDU_LOGIN_URL.to_string()),
        Provider::Xunlei => Ok("about:blank".to_string()),
        Provider::Unknown => Err(backend_error("provider", -3, "不支持的网盘平台")),
    }
}

/// 返回全局登录捕获标志集合的静态引用，用于防止同一窗口重复采集。
pub(crate) fn login_capture_flags() -> &'static Mutex<std::collections::HashSet<String>> {
    login_capture_in_progress()
}

/// 清除指定窗口标签的登录捕获标志。
pub fn clear_login_capture_flag(label: &str) {
    if let Ok(mut flags) = login_capture_flags().lock() {
        flags.remove(label);
    }
}

/// 尝试标记指定窗口开始捕获；返回 `true` 表示首次标记成功，`false` 表示已在进行中。
pub fn mark_login_capture_started(label: &str) -> bool {
    login_capture_flags()
        .lock()
        .map(|mut flags| flags.insert(label.to_string()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_login_window_label_should_sanitize_id_and_scope_by_provider() {
        assert_eq!(
            "quark-login-acc-1_2",
            provider_login_window_label(Provider::Quark, "acc-1_2"),
            "alphanumeric, '-' and '_' are preserved",
        );
        assert_eq!(
            "baidu-login-a-b-c-d",
            provider_login_window_label(Provider::Baidu, "a@b.c/d"),
            "other special chars collapse to '-'",
        );
        assert_eq!(
            "quark-login-acc",
            provider_login_window_label(Provider::Quark, "中文acc"),
            "non-ascii is stripped then leading dashes trimmed",
        );
        assert_eq!(
            "xunlei-login-account",
            provider_login_window_label(Provider::Xunlei, "---"),
            "all-dash id falls back to 'account'",
        );
        assert_eq!(
            "quark-login-account",
            provider_login_window_label(Provider::Quark, ""),
            "empty id falls back to 'account'",
        );
        // account-scoped: different ids produce different labels
        assert_ne!(
            provider_login_window_label(Provider::Quark, "acc1"),
            provider_login_window_label(Provider::Quark, "acc2"),
        );
    }

    #[test]
    fn xunlei_review_window_label_should_be_stable_per_url() {
        let url = "https://api-pan.xunlei.com/review?token=abc";
        let label_a = xunlei_review_window_label(url);
        let label_b = xunlei_review_window_label(url);

        assert_eq!(label_a, label_b, "same url -> same label");
        assert!(
            label_a.starts_with("xunlei-review-"),
            "label carries the xunlei-review prefix, got {label_a}",
        );
        let suffix = &label_a["xunlei-review-".len()..];
        assert_eq!(
            16,
            suffix.len(),
            "hash suffix is 16 hex chars, got {suffix}"
        );
        assert!(
            suffix.chars().all(|ch| ch.is_ascii_hexdigit()),
            "hash suffix is lowercase hex, got {suffix}",
        );

        let other = xunlei_review_window_label("https://api-pan.xunlei.com/review?token=def");
        assert_ne!(label_a, other, "different url -> different label");
    }

    #[test]
    fn provider_cookie_urls_should_return_expected_hosts_per_provider() {
        let quark = provider_cookie_urls(Provider::Quark);
        assert_eq!(12, quark.len(), "quark harvests 12 urls");
        let quark_hosts: Vec<&str> = quark.iter().filter_map(|u| u.host_str()).collect();
        assert!(quark_hosts.contains(&"pan.quark.cn"));
        assert!(quark_hosts.contains(&"drive-pc.quark.cn"));
        assert!(quark_hosts.contains(&"drive.quark.cn"));
        assert!(quark_hosts.contains(&"drive-h.quark.cn"));

        let baidu = provider_cookie_urls(Provider::Baidu);
        assert_eq!(3, baidu.len(), "baidu harvests 3 urls");
        let baidu_hosts: Vec<&str> = baidu.iter().filter_map(|u| u.host_str()).collect();
        assert!(baidu_hosts.contains(&"pan.baidu.com"));
        assert!(baidu_hosts.contains(&"www.baidu.com"));
        assert!(baidu_hosts.contains(&"baidu.com"));

        assert!(
            provider_cookie_urls(Provider::Xunlei).is_empty(),
            "xunlei has no cookie urls",
        );
        assert!(
            provider_cookie_urls(Provider::Unknown).is_empty(),
            "unknown provider has no cookie urls",
        );
    }

    #[test]
    fn provider_login_success_url_should_match_success_paths_only() {
        // Quark: /list path
        assert!(provider_login_success_url(
            Provider::Quark,
            &tauri::Url::parse("https://pan.quark.cn/list").unwrap(),
        ));
        // Quark: #/list fragment
        assert!(provider_login_success_url(
            Provider::Quark,
            &tauri::Url::parse("https://pan.quark.cn/#/list").unwrap(),
        ));
        // Quark: unrelated path
        assert!(!provider_login_success_url(
            Provider::Quark,
            &tauri::Url::parse("https://pan.quark.cn/").unwrap(),
        ));

        // Baidu: /disk/ path
        assert!(provider_login_success_url(
            Provider::Baidu,
            &tauri::Url::parse("https://pan.baidu.com/disk/home").unwrap(),
        ));
        // Baidu: /mbox/ path
        assert!(provider_login_success_url(
            Provider::Baidu,
            &tauri::Url::parse("https://pan.baidu.com/mbox/1").unwrap(),
        ));
        // Baidu: unrelated path
        assert!(!provider_login_success_url(
            Provider::Baidu,
            &tauri::Url::parse("https://pan.baidu.com/").unwrap(),
        ));

        // Xunlei never matches
        assert!(!provider_login_success_url(
            Provider::Xunlei,
            &tauri::Url::parse("https://pan.xunlei.com/list").unwrap(),
        ));

        // Cross-provider: quark success URL is not a baidu success
        assert!(!provider_login_success_url(
            Provider::Baidu,
            &tauri::Url::parse("https://pan.quark.cn/list").unwrap(),
        ));
    }

    #[test]
    fn mark_and_clear_login_capture_flag_should_roundtrip_once() {
        // Unique label + clear before/after to avoid cross-test contamination from the
        // shared global Mutex.
        let label = "test-windows-capture-flag-unique";
        clear_login_capture_flag(label);

        assert!(
            mark_login_capture_started(label),
            "first mark on a fresh label returns true",
        );
        assert!(
            !mark_login_capture_started(label),
            "repeat mark while in progress returns false",
        );

        clear_login_capture_flag(label);
        assert!(
            mark_login_capture_started(label),
            "after clear, the label can be marked again",
        );

        clear_login_capture_flag(label);
    }
}
