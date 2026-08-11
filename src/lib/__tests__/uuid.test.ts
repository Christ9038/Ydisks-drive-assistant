import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../uuid';

describe('uuidv7', () => {
  it('生成 RFC 9562 UUIDv7 并在同一毫秒保持字典序递增', () => {
    const first = uuidv7(1_700_000_000_000);
    const second = uuidv7(1_700_000_000_000);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second > first).toBe(true);
  });
});
