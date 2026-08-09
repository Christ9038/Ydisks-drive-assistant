// 导入资源解析纯函数：从粘贴文本 / CSV 中识别网盘分享链接、提取访问码、
// 规范化 URL（百度补 pwd）、剥离标题中的提取码文案，产出 ParsedResource 列表。
//
// 与 Rust 侧 import::parser 对应，前端这套用于浏览器 dev 兜底与即时预览。

import type { ProviderKey } from '../types';
import type { ParsedResource } from './types';

/** 根据 URL 域名识别网盘平台；无法识别时返回 'unknown'。 */
export const detectProviderFromUrl = (url: string): ProviderKey | 'unknown' => {
  const normalized = url.trim().toLowerCase();
  if (normalized.includes('pan.quark.cn')) {
    return 'quark';
  }
  if (normalized.includes('pan.baidu.com')) {
    return 'baidu';
  }
  if (normalized.includes('pan.xunlei.com') || normalized.includes('cloud.xunlei.com')) {
    return 'xunlei';
  }
  return 'unknown';
};

/** 去除分享链接首尾空白与末尾的全角/半角分隔符。 */
export const normalizeShareUrl = (url: string) => url.trim().replace(/[，。,;\s]+$/g, '');

/** 从一行文本中提取第一个 http(s) 链接并规范化。 */
export const extractUrl = (line: string) => {
  const match = line.match(/https?:\/\/[^\s,，]+/i);
  return match ? normalizeShareUrl(match[0]) : '';
};

/** 从文本中提取形如「提取码: abcd」的 4 位访问码。 */
export const extractAccessCode = (text: string) => {
  const match = text.match(/(?:提取码|访问码|密码|pwd|code)\s*[:：=\-]?\s*([A-Za-z0-9]{4})/i);
  return match?.[1] ?? '';
};

/** 文本恰好为 4 位字母数字时视为裸访问码。 */
export const extractLooseAccessCode = (text: string) => {
  const match = text.trim().match(/^([A-Za-z0-9]{4})$/);
  return match?.[1] ?? '';
};

/** 仅对百度链接补 `pwd=` 参数（已有则跳过）；非百度或无访问码时原样返回。 */
export const appendBaiduAccessCode = (url: string, text: string, explicitCode = '') => {
  if (detectProviderFromUrl(url) !== 'baidu' || /[?&]pwd=/i.test(url)) {
    return url;
  }
  const code = explicitCode || extractAccessCode(text);
  if (!code) {
    return url;
  }
  const [base, fragment = ''] = url.split('#');
  const next = `${base}${base.includes('?') ? '&' : '?'}pwd=${encodeURIComponent(code)}`;
  return fragment ? `${next}#${fragment}` : next;
};

/** 从文本中剥离「提取码: abcd」这类访问码描述并压缩空白。 */
export const stripAccessCodeText = (text: string) => text
  .replace(/(?:提取码|访问码|密码|pwd|code)\s*[:：=\-]?\s*[A-Za-z0-9]{4}/ig, '')
  .replace(/\s+/g, ' ')
  .trim();

/** 解析单行资源：抽取链接、补百度访问码、以剩余文本作为标题。 */
export const parseResourceLine = (line: string): ParsedResource | null => {
  const rawSourceUrl = extractUrl(line);
  if (!rawSourceUrl) {
    return null;
  }
  const sourceUrl = appendBaiduAccessCode(rawSourceUrl, line);

  const title = stripAccessCodeText(line
    .replace(rawSourceUrl, '')
    .replace(/[，,|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());

  return {
    title: title || '未命名资源',
    sourceUrl,
    provider: detectProviderFromUrl(sourceUrl),
  };
};

/** 按行解析粘贴文本为资源列表（空行/无链接行被过滤）。 */
export const parseTextResources = (text: string) => text
  .split(/\r?\n/)
  .map((line) => parseResourceLine(line.trim()))
  .filter((item): item is ParsedResource => Boolean(item));

/** 解析 CSV 文本为资源列表：跳过表头行，按「标题,链接,访问码」三列解析。 */
export const parseCsvResources = (text: string) => {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  return rows
    .map((row, index) => {
      if (index === 0 && /标题|网盘链接|链接/.test(row)) {
        return null;
      }
      const [title = '', sourceUrl = '', accessCode = ''] = row.split(',').map((cell) => cell.trim());
      const rawUrl = normalizeShareUrl(sourceUrl || extractUrl(row));
      if (!rawUrl) {
        return null;
      }
      const url = appendBaiduAccessCode(rawUrl, row, extractAccessCode(accessCode) || extractLooseAccessCode(accessCode));
      return {
        title: title || '未命名资源',
        sourceUrl: url,
        provider: detectProviderFromUrl(url),
      };
    })
    .filter((item): item is ParsedResource => Boolean(item));
};

/** 给 URL 追加一个查询参数（已存在同名参数则跳过）。 */
export const withUrlParam = (url: string, key: string, value: string) => {
  if (!url || !value || url.includes(`${key}=`)) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
};
