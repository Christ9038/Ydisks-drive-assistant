// CSV 导出纯函数：历史记录 → CSV 字符串（含 BOM 由调用方拼接）。

import { providerLabels, statusLabels } from './constants';
import type { HistoryRecord } from './types';

/** CSV 单元格转义：用双引号包裹，内部双引号翻倍。 */
export const csvEscape = (value: string | number | undefined) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * 把一条历史记录展开为 CSV 文本。
 *
 * 每个队列项若含多个短链则展开为多行；无短链时以单行（空渠道）兜底。
 * 列顺序固定：平台 / 转存账号 / 标题 / 源地址 / 我的网盘链接 /
 * 短链渠道 / 短链 URL / 状态 / 错误原因。
 */
export const buildHistoryCsv = (history: HistoryRecord): string => {
  const rows = [
    ['平台', '转存账号', '标题', '源地址', '我的网盘链接', '短链渠道', '短链 URL', '状态', '错误原因'],
    ...history.items.flatMap((item) => {
      const links = item.shortLinks?.length ? item.shortLinks : [{ channelName: '', domain: '', shortUrl: item.shortUrl ?? '' }];
      return links.map((link) => [
        providerLabels[item.provider],
        item.accountName ?? '',
        item.title,
        item.sourceUrl,
        item.shareUrl ?? '',
        link.channelName,
        link.shortUrl,
        statusLabels[item.status],
        item.error ?? '',
      ]);
    }),
  ];

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
};
