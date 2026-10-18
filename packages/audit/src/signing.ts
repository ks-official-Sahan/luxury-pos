import { canonicalJson } from "./canonical";
import { hmacSha256, sha256Hex, subtle, timingSafeEqual, toBase64Url, utf8 } from "./webcrypto";

/** HMAC-SHA256 over canonicalJson(payload), base64url (no padding). */
export async function signTransaction(secret: string, payload: unknown): Promise<string> {
  return toBase64Url(await hmacSha256(secret, canonicalJson(payload)));
}

/** Constant-time comparison; any payload change or wrong secret fails. */
export async function verifyTransaction(secret: string, payload: unknown, sig: string): Promise<boolean> {
  return timingSafeEqual(await signTransaction(secret, payload), sig);
}

export interface RequestParts {
  secret: string;
  method: string;
  path: string;
  body: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  nonce: string;
}

/** Signs `${METHOD}\n${path}\n${timestamp}\n${nonce}\n${sha256hex(body)}`. Method is upper-cased. */
export async function signRequest(p: RequestParts): Promise<string> {
  const msg = `${p.method.toUpperCase()}\n${p.path}\n${p.timestamp}\n${p.nonce}\n${await sha256Hex(p.body)}`;
  return toBase64Url(await hmacSha256(p.secret, msg));
}

export interface VerifyRequestInput extends RequestParts {
  signature: string;
  now: number;
  maxSkewMs?: number;
  /** Atomically records the nonce; returns true if it was already seen. */
  seenNonce: (nonce: string) => boolean | Promise<boolean>;
}

export interface VerifyRequestResult { ok: boolean; reason?: "skew" | "replay" | "bad_signature" }

/** Order: skew, signature, then nonce. The nonce is recorded only after the signature is valid so forgers cannot burn nonces. */
export async function verifyRequest(i: VerifyRequestInput): Promise<VerifyRequestResult> {
  const maxSkew = i.maxSkewMs ?? 300_000;
  if (!Number.isFinite(i.timestamp) || Math.abs(i.now - i.timestamp) > maxSkew) return { ok: false, reason: "skew" };
  const expected = await signRequest(i);
  if (!timingSafeEqual(expected, i.signature)) return { ok: false, reason: "bad_signature" };
  if (await i.seenNonce(i.nonce)) return { ok: false, reason: "replay" };
  return { ok: true };
}

/** HKDF-SHA256(master, salt = "luxury-pos/device", info = deviceId) -> 32 bytes, base64url. Deterministic; server stores only the master. */
export async function deriveDeviceSecret(masterSecret: string, deviceId: string): Promise<string> {
  const s = subtle();
  const key = await s.importKey("raw", utf8(masterSecret), "HKDF", false, ["deriveBits"]);
  const bits = await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: utf8("luxury-pos/device"), info: utf8(deviceId) }, key, 256);
  return toBase64Url(bits);
}
