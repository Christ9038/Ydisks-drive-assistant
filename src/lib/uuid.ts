let lastTimestamp = 0;
let sequence = 0;

/** Generate an RFC 9562 UUIDv7, monotonically ordered within this process. */
export function uuidv7(now = Date.now()): string {
  const timestamp = Math.max(now, lastTimestamp);
  sequence = timestamp === lastTimestamp ? (sequence + 1) & 0x0fff : 0;
  lastTimestamp = timestamp;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let value = BigInt(timestamp);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
