import { describe, it, expect } from 'vitest';
import {
  detectProviderFromUrl,
  normalizeShareUrl,
  extractUrl,
  extractAccessCode,
  extractLooseAccessCode,
  appendBaiduAccessCode,
  stripAccessCodeText,
  parseResourceLine,
  parseTextResources,
  parseCsvResources,
  withUrlParam,
} from '../parsing';

describe('detectProviderFromUrl', () => {
  it('识别夸克 / 百度 / 迅雷域名', () => {
    expect(detectProviderFromUrl('https://pan.quark.cn/s/abc')).toBe('quark');
    expect(detectProviderFromUrl('https://pan.baidu.com/s/1xyz')).toBe('baidu');
    expect(detectProviderFromUrl('https://pan.xunlei.com/s/1')).toBe('xunlei');
    expect(detectProviderFromUrl('https://cloud.xunlei.com/share')).toBe('xunlei');
  });

  it('大小写不敏感', () => {
    expect(detectProviderFromUrl('https://PAN.QUARK.CN/s/x')).toBe('quark');
  });

  it('未知平台返回 unknown', () => {
    expect(detectProviderFromUrl('https://example.com/x')).toBe('unknown');
  });
});

describe('normalizeShareUrl', () => {
  it('去除首尾空白与末尾分隔符', () => {
    expect(normalizeShareUrl('  https://x.cn/s/a，')).toBe('https://x.cn/s/a');
    expect(normalizeShareUrl('https://x.cn/s/a。')).toBe('https://x.cn/s/a');
    expect(normalizeShareUrl('https://x.cn/s/a;')).toBe('https://x.cn/s/a');
  });
});

describe('extractUrl', () => {
  it('提取首个 http(s) 链接', () => {
    expect(extractUrl('课程 https://pan.quark.cn/s/abc 提取码: 1234')).toBe('https://pan.quark.cn/s/abc');
  });
  it('无链接返回空串', () => {
    expect(extractUrl('没有链接的文本')).toBe('');
  });
});

describe('extractAccessCode', () => {
  it('识别 提取码/访问码/密码/pwd/code 后的 4 位', () => {
    expect(extractAccessCode('提取码: abcd')).toBe('abcd');
    expect(extractAccessCode('访问码：1234')).toBe('1234');
    expect(extractAccessCode('pwd=AB12')).toBe('AB12');
    expect(extractAccessCode('code 9981')).toBe('9981');
  });
  it('无匹配返回空串', () => {
    expect(extractAccessCode('没有码')).toBe('');
  });
});

describe('extractLooseAccessCode', () => {
  it('恰好 4 位字母数字时返回', () => {
    expect(extractLooseAccessCode('a1b2')).toBe('a1b2');
  });
  it('非 4 位返回空串', () => {
    expect(extractLooseAccessCode('a1b')).toBe('');
    expect(extractLooseAccessCode('a1b23')).toBe('');
  });
});

describe('appendBaiduAccessCode', () => {
  it('百度链接补 pwd 参数', () => {
    expect(appendBaiduAccessCode('https://pan.baidu.com/s/1abc', '提取码: 1234')).toBe('https://pan.baidu.com/s/1abc?pwd=1234');
  });
  it('已有 pwd 时跳过', () => {
    expect(appendBaiduAccessCode('https://pan.baidu.com/s/1abc?pwd=9999', '提取码: 1234')).toBe('https://pan.baidu.com/s/1abc?pwd=9999');
  });
  it('非百度链接原样返回', () => {
    expect(appendBaiduAccessCode('https://pan.quark.cn/s/abc', '提取码: 1234')).toBe('https://pan.quark.cn/s/abc');
  });
  it('无访问码原样返回', () => {
    expect(appendBaiduAccessCode('https://pan.baidu.com/s/1abc', '没有码')).toBe('https://pan.baidu.com/s/1abc');
  });
  it('保留 fragment', () => {
    expect(appendBaiduAccessCode('https://pan.baidu.com/s/1abc#top', '提取码: 1234')).toBe('https://pan.baidu.com/s/1abc?pwd=1234#top');
  });
});

describe('stripAccessCodeText', () => {
  it('剥离提取码描述并压缩空白', () => {
    expect(stripAccessCodeText('课程 提取码: 1234')).toBe('课程');
    expect(stripAccessCodeText('a  b   c')).toBe('a b c');
  });
});

describe('parseResourceLine', () => {
  it('抽取链接与标题', () => {
    const r = parseResourceLine('我的课程 https://pan.quark.cn/s/abc 提取码: 1234');
    expect(r).not.toBeNull();
    expect(r!.sourceUrl).toBe('https://pan.quark.cn/s/abc');
    expect(r!.title).toBe('我的课程');
    expect(r!.provider).toBe('quark');
  });
  it('无链接返回 null', () => {
    expect(parseResourceLine('纯文本')).toBeNull();
  });
  it('无标题时使用「未命名资源」', () => {
    const r = parseResourceLine('https://pan.quark.cn/s/abc');
    expect(r!.title).toBe('未命名资源');
  });
});

describe('parseTextResources', () => {
  it('按行解析多链接', () => {
    const items = parseTextResources('https://pan.quark.cn/s/a\n\nhttps://pan.baidu.com/s/1b 提取码: 1234\n纯文本');
    expect(items).toHaveLength(2);
    expect(items[0].provider).toBe('quark');
    expect(items[1].provider).toBe('baidu');
    expect(items[1].sourceUrl).toBe('https://pan.baidu.com/s/1b?pwd=1234');
  });
});

describe('parseCsvResources', () => {
  it('跳过表头并按三列解析', () => {
    const csv = '标题,网盘链接,提取码\n课程A,https://pan.quark.cn/s/a,\n课程B,https://pan.baidu.com/s/1b,1234';
    const items = parseCsvResources(csv);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('课程A');
    expect(items[1].sourceUrl).toBe('https://pan.baidu.com/s/1b?pwd=1234');
  });
  it('无表头时全部当数据行', () => {
    const items = parseCsvResources('课程A,https://pan.quark.cn/s/a,');
    expect(items).toHaveLength(1);
  });

  it('无链接的数据行被过滤', () => {
    const items = parseCsvResources('标题,网盘链接\n课程A,https://pan.quark.cn/s/a\n纯文本无链接');
    expect(items).toHaveLength(1);
  });
});

describe('withUrlParam', () => {
  it('追加查询参数', () => {
    expect(withUrlParam('https://x.cn/s', 'deviceid', 'abc')).toBe('https://x.cn/s?deviceid=abc');
    expect(withUrlParam('https://x.cn/s?a=1', 'deviceid', 'abc')).toBe('https://x.cn/s?a=1&deviceid=abc');
  });
  it('已存在同名参数时跳过', () => {
    expect(withUrlParam('https://x.cn/s?deviceid=old', 'deviceid', 'new')).toBe('https://x.cn/s?deviceid=old');
  });
  it('空 url 或空 value 原样返回', () => {
    expect(withUrlParam('', 'k', 'v')).toBe('');
    expect(withUrlParam('https://x.cn', 'k', '')).toBe('https://x.cn');
  });
});

describe('appendBaiduAccessCode / parseCsvResources 分支补充', () => {
  it('百度链接已有其它查询参数时用 & 追加 pwd', () => {
    expect(appendBaiduAccessCode('https://pan.baidu.com/s/1abc?from=share', '提取码: 1234')).toBe('https://pan.baidu.com/s/1abc?from=share&pwd=1234');
  });
  it('CSV 访问码列含关键词时识别', () => {
    const items = parseCsvResources('课程,https://pan.baidu.com/s/1b,提取码:1234');
    expect(items[0].sourceUrl).toBe('https://pan.baidu.com/s/1b?pwd=1234');
  });
});
