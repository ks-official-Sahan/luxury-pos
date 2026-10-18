const enc = new TextEncoder();

/** Hex HMAC-SHA256 via WebCrypto (isomorphic). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let out = "";
  for (const b of sig) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Constant-time string comparison (length difference leaks only length). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Case-insensitive header lookup. */
export function header(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return headers[k];
  return undefined;
}
