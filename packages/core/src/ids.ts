let lastMs = -1;
let counter = 0;

/**
 * UUIDv7 (RFC 9562): 48-bit Unix ms timestamp, then a 12-bit counter in rand_a
 * (method 1), then 62 random bits. Ids made on one device are strictly increasing
 * even within the same millisecond or if the clock steps back, so they sort and
 * index well (B-tree append) and double as idempotency keys for outbox replay.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = Math.max(now, lastMs);
  if (ms === lastMs) {
    counter++;
    if (counter > 0xfff) {
      ms++; // counter exhausted: borrow the next millisecond rather than repeat
      counter = bytes[7]! & 0x3ff;
    }
  } else counter = ((bytes[6]! & 0x03) << 8) | bytes[7]!; // random start, top bits clear for headroom
  lastMs = ms;
  let ts = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Milliseconds since epoch encoded in a UUIDv7 (for time-range scans and debugging). */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}

/** Human receipt number: store code + device code + per-device sequence (no server round trip needed). */
export function receiptNumber(storeCode: string, deviceCode: string, sequence: number): string {
  return `${storeCode}-${deviceCode}-${String(sequence).padStart(6, "0")}`;
}
