import { describe, it, expect } from 'vitest';
import { getBackendErrorPayload, formatBackendError, extractXunleiReviewState } from '../format';

describe('getBackendErrorPayload', () => {
  it('含 message 的对象返回载荷', () => {
    const payload = getBackendErrorPayload({ message: '失败', stage: 'transfer', code: 5 });
    expect(payload?.message).toBe('失败');
    expect(payload?.stage).toBe('transfer');
  });
  it('无 message 返回 null', () => {
    expect(getBackendErrorPayload({ code: 5 })).toBeNull();
  });
  it('非对象返回 null', () => {
    expect(getBackendErrorPayload('字符串错误')).toBeNull();
    expect(getBackendErrorPayload(null)).toBeNull();
  });
});

describe('formatBackendError', () => {
  it('组装 stage / message / code', () => {
    expect(formatBackendError({ stage: 'transfer', code: 5, message: '转存失败' })).toBe('transfer: 转存失败（5）');
  });
  it('无 stage/code 时仅 message', () => {
    expect(formatBackendError({ message: '失败' })).toBe('失败');
  });
  it('Error 实例回落到 message', () => {
    expect(formatBackendError(new Error('boom'))).toBe('boom');
  });
  it('Error 实例但 message 为空时回落到空串（instanceof 分支）', () => {
    // message 为空串 -> getBackendErrorPayload 返回 null -> 走 instanceof Error 分支
    expect(formatBackendError(new Error(''))).toBe('');
  });
  it('其他类型回落到 String', () => {
    expect(formatBackendError(42)).toBe('42');
  });
  it('载荷 message 为空字符串时回落到 String', () => {
    expect(formatBackendError({ message: '' })).toBe('[object Object]');
  });
  it('null / 无 message 对象回落到 String', () => {
    expect(formatBackendError(null)).toBe('null');
    expect(formatBackendError({ stage: 'x' })).toBe('[object Object]');
  });
});

describe('extractXunleiReviewState', () => {
  it('stage=xunlei_review 标记需要验证', () => {
    const state = extractXunleiReviewState({ stage: 'xunlei_review', message: '需验证' }, '需验证');
    expect(state.needsReview).toBe(true);
  });
  it('code=1007 标记需要验证', () => {
    const state = extractXunleiReviewState({ code: 1007, message: 'x' }, 'x');
    expect(state.needsReview).toBe(true);
  });
  it('消息含 review_panel 标记需要验证', () => {
    const state = extractXunleiReviewState({}, '请完成 review_panel 验证');
    expect(state.needsReview).toBe(true);
  });
  it('普通错误不标记需要验证', () => {
    const state = extractXunleiReviewState({ stage: 'transfer', message: '网络错误' }, '网络错误');
    expect(state.needsReview).toBe(false);
  });
  it('details 中的 reviewUrl 注入 deviceid 参数', () => {
    const state = extractXunleiReviewState(
      { stage: 'xunlei_review', message: 'x', details: { reviewUrl: 'https://x.cn/review', deviceId: 'dev1' } },
      'x',
    );
    expect(state.reviewUrl).toBe('https://x.cn/review?deviceid=dev1');
    expect(state.deviceId).toBe('dev1');
  });
  it('从消息中提取 creditKey', () => {
    const state = extractXunleiReviewState({}, 'creditkey: abc123; 其它');
    expect(state.creditKey).toBe('abc123');
  });
  it('details.rawReviewUrl 作为 reviewUrlBase 并注入 deviceid', () => {
    const state = extractXunleiReviewState({ message: 'x', details: { rawReviewUrl: 'https://x.cn/r', deviceId: 'd' } }, 'x');
    expect(state.rawReviewUrl).toBe('https://x.cn/r');
    expect(state.reviewUrl).toBe('https://x.cn/r?deviceid=d');
  });
  it('从消息中提取 reviewUrl 并去除末尾分隔符', () => {
    const state = extractXunleiReviewState({}, '请完成 https://x.cn/r）');
    expect(state.reviewUrl).toBe('https://x.cn/r');
  });
  it('deviceSign 作为 deviceId 兜底', () => {
    const state = extractXunleiReviewState({ message: 'x', details: { deviceSign: 'ds' } }, 'x');
    expect(state.deviceId).toBe('ds');
  });
  it('details.creditKey 优先于消息', () => {
    const state = extractXunleiReviewState({ message: 'x', details: { creditKey: 'ck1' } }, 'creditkey: msg2');
    expect(state.creditKey).toBe('ck1');
  });
  it('无任何来源时 reviewUrl / creditKey 为空', () => {
    const state = extractXunleiReviewState({}, '普通消息');
    expect(state.reviewUrl).toBe('');
    expect(state.creditKey).toBe('');
    expect(state.rawReviewUrl).toBe('');
  });
});
