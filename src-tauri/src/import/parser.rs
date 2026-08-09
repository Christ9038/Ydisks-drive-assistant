//! 导入解析实现。

use std::collections::HashSet;

use crate::types::{ImportParseResult, ParsedImportResource, Provider, QuotaPlan};

/// 检测链接所属网盘平台。
pub fn detect_provider(url: &str) -> Provider {
    let normalized = url.trim().to_ascii_lowercase();
    if normalized.contains("pan.quark.cn") {
        return Provider::Quark;
    }
    if normalized.contains("pan.baidu.com") {
        return Provider::Baidu;
    }
    if normalized.contains("pan.xunlei.com") || normalized.contains("cloud.xunlei.com") {
        return Provider::Xunlei;
    }
    Provider::Unknown
}

/// 规整分享链接：去首尾空白，并去掉尾部的全角/半角标点（逗号、句号、分号等）。
pub fn normalize_share_url(url: &str) -> String {
    url.trim()
        .trim_end_matches(|ch: char| ch.is_whitespace() || matches!(ch, ',' | '，' | '。' | ';'))
        .to_string()
}

/// 从文本中按标签（提取码/访问码/密码/pwd/code）提取 4 位提取码，找不到返回 `None`。
fn extract_labeled_access_code(text: &str) -> Option<String> {
    let normalized = text.replace('：', ":");
    let lower = normalized.to_ascii_lowercase();
    for label in ["提取码", "访问码", "密码", "pwd", "code"] {
        let Some(index) = lower.find(label) else {
            continue;
        };
        let tail = &normalized[index + label.len()..];
        let code = tail
            .chars()
            .skip_while(|ch| ch.is_whitespace() || matches!(ch, ':' | '=' | '-' | '：'))
            .take_while(|ch| ch.is_ascii_alphanumeric())
            .take(4)
            .collect::<String>();
        if code.len() == 4 {
            return Some(code);
        }
    }
    None
}

/// 宽松提取：直接取文本开头的 4 位字母数字作为提取码，不足 4 位返回 `None`。
fn extract_loose_access_code(text: &str) -> Option<String> {
    let code = text
        .trim()
        .trim_matches(|ch: char| matches!(ch, ',' | '，' | ';' | '；'))
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric())
        .take(4)
        .collect::<String>();
    (code.len() == 4).then_some(code)
}

/// 从标题文本中剔除提取码标签及其内联取码（如"提取码:9x8y"），保留剩余词并以空格连接。
fn remove_labeled_access_code(text: &str) -> String {
    let mut words = text.split_whitespace().peekable();
    let mut kept = Vec::new();
    while let Some(word) = words.next() {
        let normalized = word.trim_matches(|ch: char| matches!(ch, ',' | '，' | ':' | '：'));
        let lower = normalized.to_ascii_lowercase();
        let is_label = matches!(normalized, "提取码" | "访问码" | "密码")
            || matches!(lower.as_str(), "pwd" | "code");
        let inline_code = ["提取码", "访问码", "密码", "pwd", "code"]
            .iter()
            .any(|label| {
                let label_lower = label.to_ascii_lowercase();
                lower.starts_with(&label_lower)
                    && normalized[label.len()..]
                        .chars()
                        .next()
                        .is_some_and(|ch| matches!(ch, ':' | '：' | '=' | '-'))
            });
        if is_label {
            let _ = words.next();
            continue;
        }
        if inline_code {
            continue;
        }
        kept.push(word);
    }
    kept.join(" ")
}

/// 为百度链接补 `pwd=` 参数：仅对百度且尚无 `pwd=` 的链接生效，从文本中提取码后拼到查询串。
fn append_baidu_pwd_from_text(url: &str, text: &str) -> String {
    if detect_provider(url) != Provider::Baidu || url.contains("pwd=") {
        return url.to_string();
    }
    let Some(code) = extract_labeled_access_code(text).or_else(|| {
        text.split(|ch: char| matches!(ch, ',' | '，' | '\t'))
            .skip(2)
            .find_map(extract_loose_access_code)
    }) else {
        return url.to_string();
    };
    let (base, fragment) = url.split_once('#').unwrap_or((url, ""));
    let separator = if base.contains('?') { '&' } else { '?' };
    let next = format!("{base}{separator}pwd={code}");
    if fragment.is_empty() {
        next
    } else {
        format!("{next}#{fragment}")
    }
}

/// 从一行文本中取出首个 `http(s)://` 开头的链接并规整，找不到返回 `None`。
fn extract_url(line: &str) -> Option<String> {
    line.split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | '，'))
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(normalize_share_url)
        .filter(|url| !url.is_empty())
}

/// 解析单行粘贴文本为资源：提取链接、补百度提取码、剔除标签后以剩余文本作为标题（空则"未命名资源"）。
fn parse_resource_line(line: &str) -> Option<ParsedImportResource> {
    let raw_source_url = extract_url(line)?;
    let source_url = append_baidu_pwd_from_text(&raw_source_url, line);
    let title = line
        .replace(&raw_source_url, "")
        .replace([',', '，', '|'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title = remove_labeled_access_code(&title);
    Some(ParsedImportResource {
        title: if title.is_empty() {
            "未命名资源".to_string()
        } else {
            title
        },
        provider: detect_provider(&source_url),
        source_url,
    })
}

/// 解析单行 CSV 为资源：首列为标题、次列为链接、第三列为提取码；首行命中表头关键词时跳过。
fn parse_csv_line(line: &str, index: usize) -> Option<ParsedImportResource> {
    if index == 0 && (line.contains("标题") || line.contains("网盘链接") || line.contains("链接"))
    {
        return None;
    }

    let cells = line.split(',').map(str::trim).collect::<Vec<_>>();
    let raw_source_url = cells
        .get(1)
        .map(|value| normalize_share_url(value))
        .filter(|value| !value.is_empty())
        .or_else(|| extract_url(line))?;
    let access_code = cells.get(2).and_then(|value| {
        extract_labeled_access_code(value).or_else(|| extract_loose_access_code(value))
    });
    let source_url = access_code
        .map(|code| append_baidu_pwd_from_text(&raw_source_url, &format!("提取码 {code}")))
        .unwrap_or_else(|| append_baidu_pwd_from_text(&raw_source_url, line));
    let title = cells
        .first()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "未命名资源".to_string());

    Some(ParsedImportResource {
        title,
        provider: detect_provider(&source_url),
        source_url,
    })
}

/// 解析粘贴文本，并过滤平台不符、无法识别和重复链接。
pub fn parse_import_text(
    provider: Provider,
    account_id: &str,
    text: &str,
    existing_urls: &[String],
    dedupe_enabled: bool,
) -> ImportParseResult {
    parse_import_items(
        provider,
        account_id,
        text.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(parse_resource_line)
            .collect(),
        existing_urls,
        dedupe_enabled,
    )
}

/// 解析 CSV，并过滤平台不符、无法识别和重复链接。
pub fn parse_import_csv(
    provider: Provider,
    account_id: &str,
    text: &str,
    existing_urls: &[String],
    dedupe_enabled: bool,
) -> ImportParseResult {
    parse_import_items(
        provider,
        account_id,
        text.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .enumerate()
            .map(|(index, line)| parse_csv_line(line, index))
            .collect(),
        existing_urls,
        dedupe_enabled,
    )
}

/// 汇总已解析条目：按平台过滤、去重（受 `dedupe_enabled` 控制），统计被过滤数量并返回 [`ImportParseResult`]。
fn parse_import_items(
    provider: Provider,
    _account_id: &str,
    parsed_items: Vec<Option<ParsedImportResource>>,
    existing_urls: &[String],
    dedupe_enabled: bool,
) -> ImportParseResult {
    let mut seen_urls = existing_urls
        .iter()
        .map(|url| normalize_share_url(url))
        .collect::<HashSet<_>>();
    let mut accepted = Vec::new();
    let mut filtered = 0;

    for parsed in parsed_items {
        let Some(item) = parsed else {
            filtered += 1;
            continue;
        };
        let normalized_url = normalize_share_url(&item.source_url);
        let duplicated = dedupe_enabled && seen_urls.contains(&normalized_url);
        if item.provider == Provider::Unknown || item.provider != provider || duplicated {
            filtered += 1;
            continue;
        }

        seen_urls.insert(normalized_url);
        accepted.push(item);
    }

    ImportParseResult { accepted, filtered }
}

/// 根据有效输入数量、短链渠道数与短链余量生成执行计划。
pub fn calculate_quota_plan(
    valid_items: u32,
    selected_channels: u32,
    max_links: u32,
    used_links: u32,
) -> QuotaPlan {
    let remaining_links = max_links.saturating_sub(used_links);
    let required_links = valid_items.saturating_mul(selected_channels);
    let executable_items = if selected_channels == 0 {
        valid_items
    } else {
        valid_items.min(remaining_links / selected_channels)
    };
    QuotaPlan {
        valid_items,
        selected_channels,
        required_links,
        remaining_links,
        executable_items,
        waiting_quota_items: valid_items.saturating_sub(executable_items),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_provider_should_match_supported_platforms() {
        assert_eq!(
            Provider::Quark,
            detect_provider("https://pan.quark.cn/s/abc")
        );
        assert_eq!(
            Provider::Baidu,
            detect_provider("https://pan.baidu.com/s/abc")
        );
        assert_eq!(
            Provider::Xunlei,
            detect_provider("https://pan.xunlei.com/s/abc")
        );
        assert_eq!(
            Provider::Xunlei,
            detect_provider("https://cloud.xunlei.com/s/abc")
        );
        assert_eq!(
            Provider::Unknown,
            detect_provider("https://example.com/s/abc")
        );
    }

    #[test]
    fn calculate_quota_plan_should_cut_to_remaining_links() {
        let plan = calculate_quota_plan(37, 1, 120, 92);
        assert_eq!(
            QuotaPlan {
                valid_items: 37,
                selected_channels: 1,
                required_links: 37,
                remaining_links: 28,
                executable_items: 28,
                waiting_quota_items: 9,
            },
            plan,
        );
    }

    #[test]
    fn calculate_quota_plan_should_handle_used_links_overflow() {
        let plan = calculate_quota_plan(8, 1, 5, 9);
        assert_eq!(0, plan.remaining_links);
        assert_eq!(0, plan.executable_items);
        assert_eq!(8, plan.waiting_quota_items);
    }

    #[test]
    fn calculate_quota_plan_should_count_selected_channels() {
        let plan = calculate_quota_plan(10, 2, 30, 6);
        assert_eq!(2, plan.selected_channels);
        assert_eq!(20, plan.required_links);
        assert_eq!(24, plan.remaining_links);
        assert_eq!(10, plan.executable_items);
        assert_eq!(0, plan.waiting_quota_items);
    }

    #[test]
    fn calculate_quota_plan_should_allow_no_shortlink_channels() {
        let plan = calculate_quota_plan(10, 0, 30, 30);
        assert_eq!(0, plan.selected_channels);
        assert_eq!(0, plan.required_links);
        assert_eq!(0, plan.remaining_links);
        assert_eq!(10, plan.executable_items);
        assert_eq!(0, plan.waiting_quota_items);
    }

    #[test]
    fn parse_import_text_should_filter_wrong_platform_and_duplicates() {
        let result = parse_import_text(
            Provider::Quark,
            "acc",
            "https://pan.quark.cn/s/aaa 标题A\nhttps://pan.baidu.com/s/bbb 标题B\nhttps://pan.quark.cn/s/aaa 标题A重复",
            &[],
            true,
        );
        assert_eq!(1, result.accepted.len());
        assert_eq!(2, result.filtered);
    }

    #[test]
    fn parse_import_text_should_append_baidu_pwd_from_labeled_code() {
        let result = parse_import_text(
            Provider::Baidu,
            "acc",
            "https://pan.baidu.com/s/1abcdEFG 提取码:9x8y",
            &[],
            true,
        );
        assert_eq!(1, result.accepted.len());
        assert_eq!(
            "https://pan.baidu.com/s/1abcdEFG?pwd=9x8y",
            result.accepted[0].source_url,
        );
    }

    #[test]
    fn parse_import_csv_should_append_baidu_pwd_from_third_column() {
        let csv = "标题,网盘链接,提取码\n标题A,https://pan.baidu.com/s/1abcdEFG,9x8y";
        let result = parse_import_csv(Provider::Baidu, "acc", csv, &[], true);
        assert_eq!(1, result.accepted.len());
        assert_eq!(
            "https://pan.baidu.com/s/1abcdEFG?pwd=9x8y",
            result.accepted[0].source_url,
        );
    }

    #[test]
    fn parse_import_csv_should_skip_header_and_keep_supported_rows() {
        let csv = "标题,网盘链接,提取码\n标题A,https://pan.quark.cn/s/aaa,\n标题B,https://pan.baidu.com/s/bbb,";
        let result = parse_import_csv(Provider::Quark, "acc", csv, &[], true);
        assert_eq!(1, result.accepted.len());
        assert_eq!("标题A", result.accepted[0].title);
    }

    #[test]
    fn extract_labeled_access_code_should_read_codes_after_known_labels() {
        assert_eq!(
            Some("abcd".to_string()),
            extract_labeled_access_code("提取码: abcd"),
        );
        assert_eq!(
            Some("1234".to_string()),
            extract_labeled_access_code("访问码：1234"),
            "fullwidth colon is normalized",
        );
        assert_eq!(
            Some("xyz9".to_string()),
            extract_labeled_access_code("pwd=xyz9"),
        );
        assert_eq!(
            Some("AB12".to_string()),
            extract_labeled_access_code("CODE:AB12"),
            "label match is case-insensitive, code keeps case",
        );
        assert_eq!(
            Some("abcd".to_string()),
            extract_labeled_access_code("提取码abcd"),
            "separator is optional",
        );
        assert_eq!(
            None,
            extract_labeled_access_code("code: abc"),
            "code shorter than 4 yields None",
        );
        assert_eq!(None, extract_labeled_access_code("无标签 1234"));
    }

    #[test]
    fn extract_loose_access_code_should_take_leading_four_alphanumerics() {
        assert_eq!(Some("abcd".to_string()), extract_loose_access_code("abcd"));
        assert_eq!(Some("ab12".to_string()), extract_loose_access_code("ab12"));
        assert_eq!(
            Some("abcd".to_string()),
            extract_loose_access_code("abcd,"),
            "trailing comma is trimmed",
        );
        assert_eq!(None, extract_loose_access_code("abc"), "too short");
        assert_eq!(
            Some("12ab".to_string()),
            extract_loose_access_code("12ab extra"),
            "stops at whitespace",
        );
    }

    #[test]
    fn remove_labeled_access_code_should_drop_label_and_inline_code() {
        assert_eq!(
            "标题",
            remove_labeled_access_code("标题 提取码 abcd"),
            "labeled code consumes the following word",
        );
        assert_eq!(
            "标题",
            remove_labeled_access_code("标题 提取码:abcd"),
            "inline 提取码:abcd is dropped",
        );
        assert_eq!("标题A", remove_labeled_access_code("标题A pwd xyz"));
        assert_eq!("标题", remove_labeled_access_code("标题 code-1234"));
        assert_eq!(
            "正常文本 无关词",
            remove_labeled_access_code("正常文本 无关词"),
            "non-label words are preserved",
        );
    }

    #[test]
    fn parse_resource_line_should_extract_url_title_and_provider() {
        assert_eq!(
            Some(ParsedImportResource {
                title: "标题A".to_string(),
                provider: Provider::Quark,
                source_url: "https://pan.quark.cn/s/aaa".to_string(),
            }),
            parse_resource_line("https://pan.quark.cn/s/aaa 标题A"),
        );
        assert_eq!(None, parse_resource_line("这里没有链接"), "no url -> None");
    }

    #[test]
    fn parse_csv_line_should_skip_header_and_parse_data_rows() {
        assert_eq!(
            None,
            parse_csv_line("标题,网盘链接,提取码", 0),
            "header row at index 0 is skipped",
        );
        assert_eq!(
            Some(ParsedImportResource {
                title: "标题A".to_string(),
                provider: Provider::Quark,
                source_url: "https://pan.quark.cn/s/aaa".to_string(),
            }),
            parse_csv_line("标题A,https://pan.quark.cn/s/aaa,", 1),
            "data row with empty access code",
        );
    }

    #[test]
    fn append_baidu_pwd_from_text_should_append_code_only_for_baidu() {
        assert_eq!(
            "https://pan.baidu.com/s/1abcdEFG?pwd=9x8y",
            append_baidu_pwd_from_text("https://pan.baidu.com/s/1abcdEFG", "提取码:9x8y"),
        );
        assert_eq!(
            "https://pan.baidu.com/s/1abcdEFG?pwd=old",
            append_baidu_pwd_from_text("https://pan.baidu.com/s/1abcdEFG?pwd=old", "提取码:9x8y"),
            "existing pwd= is preserved",
        );
        assert_eq!(
            "https://pan.baidu.com/s/1abcdEFG?from=share&pwd=9x8y",
            append_baidu_pwd_from_text(
                "https://pan.baidu.com/s/1abcdEFG?from=share",
                "提取码:9x8y"
            ),
            "joins with & when query already present",
        );
        assert_eq!(
            "https://pan.baidu.com/s/1abcdEFG?pwd=9x8y#frag",
            append_baidu_pwd_from_text("https://pan.baidu.com/s/1abcdEFG#frag", "提取码:9x8y"),
            "fragment is preserved after pwd",
        );
        assert_eq!(
            "https://pan.quark.cn/s/aaa",
            append_baidu_pwd_from_text("https://pan.quark.cn/s/aaa", "提取码:9x8y"),
            "non-baidu urls are returned unchanged",
        );
    }
}
