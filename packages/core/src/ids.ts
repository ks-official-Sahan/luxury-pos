/**
 * UUIDv7: time-ordered, so ids made offline on a device sort and index well
 * (B-tree friendly) and double as idempotency keys for outbox replay.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Human receipt number: store code + device code + per-device sequence (no server round trip needed). */
export function receiptNumber(storeCode: string, deviceCode: string, sequence: number): string {
  return `${storeCode}-${deviceCode}-${String(sequence).padStart(6, "0")}`;
}
