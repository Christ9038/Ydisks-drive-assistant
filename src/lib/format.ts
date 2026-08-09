// 后端错误格式化纯函数：从 Rust 返回的 { stage, code, message, details } 载荷
// 中提取可读消息，并解析迅雷二次验证（review）所需的状态。

import { withUrlParam } from './parsing';
import type { BackendErrorPayload } from './types';

/** 从未知错误中提取 BackendErrorPayload；无 message 字段时返回 null。 */
export const getBackendErrorPayload = (error: unknown): BackendErrorPayload | null => {
  if (error && typeof error === 'object') {
    const payload = error as BackendErrorPayload;
    if (payload.message) {
      return payload;
    }
  }
  return null;
};

/** 把后端错误格式化为可读字符串：`stage: message（code）`；非载荷错误回落到 Error.message。 */
export const formatBackendError = (error: unknown) => {
  const payload = getBackendErrorPayload(error);
  if (payload?.message) {
    return `${payload.stage ? `${payload.stage}: ` : ''}${payload.message}${payload.code ? `（${payload.code}）` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
};

/**
 * 从错误载荷与消息中解析迅雷二次验证状态。
 *
 * 汇总 reviewUrl（含 deviceid 参数）、creditKey、deviceId、原始 reviewUrl，
 * 以及是否需要走验证流程（stage=xunlei_review / code=1007 / 消息含 review_panel）。
 */
export const extractXunleiReviewState = (error: unknown, message: string) => {
  const payload = getBackendErrorPayload(error);
  const details = payload?.details ?? {};
  const rawReviewUrl = details.rawReviewUrl || '';
  const deviceId = details.deviceId || details.deviceSign || '';
  const reviewUrlBase = details.reviewUrl
    || rawReviewUrl
    || message.match(/https?:\/\/\S+/)?.[0]?.replace(/[，。；)）]+$/, '')
    || '';
  const reviewUrl = withUrlParam(reviewUrlBase, 'deviceid', deviceId);
  const creditKey = details.creditKey
    || message.match(/creditkey[:：]\s*([^\s；;]+)/i)?.[1]
    || '';
  const needsReview = payload?.stage === 'xunlei_review' || payload?.code === 1007 || message.includes('review_panel');
  return { creditKey, deviceId, needsReview, rawReviewUrl, reviewUrl };
};
