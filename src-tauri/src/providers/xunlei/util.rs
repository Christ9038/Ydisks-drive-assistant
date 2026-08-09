//! 迅雷纯工具函数：哈希 / 签名原语、URL 归一化、设备 ID 派生。
//!
//! 这些函数不依赖 `XunleiCredential` 与异步运行时，为纯计算，便于单测覆盖。
//! 签名算法与 alist `thunder` 驱动对齐（device_sign = `div101.{device_id}{md5(sha1(...))}`）。

use sha1::{Digest, Sha1};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::Url;

use crate::config::{XUNLEI_APP_ID, XUNLEI_APP_KEY};

/// 对字符串做 `DefaultHasher` 哈希并输出 16 位十六进制，用于按账号派生稳定的设备 ID 片段。
pub(crate) fn xunlei_hash_hex(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// 计算字符串的 MD5 并输出小写十六进制。
pub(super) fn md5_hex(value: &str) -> String {
    format!("{:x}", md5::compute(value.as_bytes()))
}

/// 将字节切片输出为小写十六进制字符串。
pub(super) fn hex_lower(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

/// 计算字符串的 SHA-1 并输出小写十六进制。
pub(super) fn sha1_hex(value: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(value.as_bytes());
    hex_lower(&hasher.finalize())
}

/// 生成迅雷设备签名 `div101.{device_id}{md5}`：把 `device_id + package_name + APP_ID + APP_KEY` 的 SHA-1 再做一次 MD5，用于迅雷 anti-replay 校验。
pub(super) fn xunlei_generate_device_sign(device_id: &str, package_name: &str) -> String {
    let sha1 = sha1_hex(&format!(
        "{device_id}{package_name}{XUNLEI_APP_ID}{XUNLEI_APP_KEY}"
    ));
    format!("div101.{device_id}{}", md5_hex(&sha1))
}

/// 归一化迅雷二次验证页 URL：解码 `&amp;`，补全协议与 `xluser-ssl.xunlei.com` 主机前缀。
pub(super) fn normalize_xunlei_review_url(value: &str) -> String {
    let trimmed = value.trim().replace("&amp;", "&");
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        trimmed
    } else if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else if trimmed.starts_with('/') {
        format!("https://xluser-ssl.xunlei.com{trimmed}")
    } else {
        trimmed
    }
}

/// 按账号 ID 派生稳定的迅雷 device_id（两段哈希拼接），同一账号每次登录得到相同设备 ID。
pub(super) fn xunlei_new_device_id(account_id: &str) -> String {
    let seed = account_id.trim();
    format!(
        "{}{}",
        xunlei_hash_hex(&format!("{seed}:xunlei-device:a")),
        xunlei_hash_hex(&format!("{seed}:xunlei-device:b"))
    )
}

/// 生成迅雷验证码签名所需的 action 字符串（`METHOD:path`），URL 解析失败时退化为纯方法名。
pub(super) fn xunlei_action(method: &str, url: &str) -> String {
    Url::parse(url)
        .map(|parsed| format!("{}:{}", method.to_uppercase(), parsed.path()))
        .unwrap_or_else(|_| method.to_uppercase())
}
