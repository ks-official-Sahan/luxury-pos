/** Minimal WebCrypto helpers (Node 22, browsers, RN with polyfill). No DOM lib types required. */

interface SubtleLike {
  digest(alg: string, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(fmt: "raw", key: Uint8Array, alg: unknown, extractable: boolean, usages: string[]): Promise<unknown>;
  sign(alg: string, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  deriveBits(alg: unknown, key: unknown, bits: number): Promise<ArrayBuffer>;
}
interface G {
  crypto?: { subtle?: SubtleLike };
  TextEncoder: new () => { encode(s: string): Uint8Array };
}
const g = globalThis as unknown as G;

export function subtle(): SubtleLike {
  const s = g.crypto?.subtle;
  if (!s) throw new Error("WebCrypto (globalThis.crypto.subtle) unavailable");
  return s;
}

export const utf8 = (s: string): Uint8Array => new g.TextEncoder().encode(s);

export function toHex(buf: ArrayBuffer): string {
  let out = "";
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, "0");
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function toBase64Url(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    if (i + 1 < b.length) out += B64[(n >> 6) & 63]!;
    if (i + 2 < b.length) out += B64[n & 63]!;
  }
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await subtle().digest("SHA-256", typeof data === "string" ? utf8(data) : data));
}

export async function hmacSha256(secret: string | Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await subtle().importKey("raw", typeof secret === "string" ? utf8(secret) : secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return subtle().sign("HMAC", key, utf8(message));
}

/** Constant-time string equality (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
