import { gtinFormat, normalizeGtin } from "./ean";
import type { GtinFormat } from "./ean";
import { parseGs1 } from "./gs1";
import type { Gs1Parsed } from "./gs1";
import { parseInStore } from "./instore";
import type { InStoreResult, InStoreScheme } from "./instore";

export interface ScanBufferOptions {
  /** Max gap between keystrokes for them to count as scanner input (default 30 ms). */
  maxInterKeyMs?: number;
  /** Minimum characters for a scan (default 6). */
  minLength?: number;
  /** Key that ends a scan (default "Enter"). */
  terminator?: string;
}

export interface ScanBuffer {
  /**
   * Feed one key event. Returns the completed scan when the terminator arrives within maxInterKeyMs of the last
   * character and the buffer holds >= minLength characters; otherwise null. A slow gap restarts the buffer, so
   * human typing never accumulates into a scan. Non-printable keys (length > 1) other than the terminator are ignored.
   */
  push(key: string, timestampMs: number): string | null;
  /** Current buffered characters. */
  pending(): string;
  reset(): void;
}

/** Keyboard-wedge scanner detector: scanners type whole codes at machine speed, humans cannot. Pure; time is passed in. */
export function createScanBuffer(opts: ScanBufferOptions = {}): ScanBuffer {
  const maxGap = opts.maxInterKeyMs ?? 30;
  const minLength = opts.minLength ?? 6;
  const terminator = opts.terminator ?? "Enter";
  let buf = "";
  let last = 0;
  return {
    push(key, t) {
      if (key === terminator) {
        const fast = buf.length > 0 && t - last <= maxGap;
        const out = fast && buf.length >= minLength ? buf : null;
        buf = "";
        return out;
      }
      if (key.length !== 1) return null;
      if (buf.length > 0 && t - last > maxGap) buf = "";
      buf += key;
      last = t;
      return null;
    },
    pending: () => buf,
    reset() {
      buf = "";
    },
  };
}

export type ScanClass =
  | { kind: "gtin"; gtin14: string; format: GtinFormat }
  | { kind: "gs1"; parsed: Gs1Parsed }
  | { kind: "instore"; result: InStoreResult }
  | { kind: "qr_url"; url: string }
  | { kind: "internal"; code: string }
  | { kind: "unknown"; reason: string };

/**
 * Classifies a completed scan. Order: URL, plain digits (in-store scheme match, then internal 2xxxxxxxxxxxx EAN-13,
 * then GTIN), then GS1 element strings. Without `schemes`, price/weight codes classify as "internal".
 */
export function classifyScan(raw: string, opts: { schemes?: readonly InStoreScheme[] } = {}): ScanClass {
  const code = raw.trim();
  if (code.length === 0) return { kind: "unknown", reason: "empty" };
  if (/^https?:\/\/\S+$/i.test(code)) return { kind: "qr_url", url: code };
  if (/^\d+$/.test(code)) {
    const format = gtinFormat(code);
    if (format === "EAN-13") {
      if (opts.schemes) {
        const result = parseInStore(code, opts.schemes);
        if (result) return { kind: "instore", result };
      }
      if (code.startsWith("2")) return { kind: "internal", code };
    }
    if (format) return { kind: "gtin", gtin14: normalizeGtin(code), format };
    if (code.length < 16) return { kind: "unknown", reason: "invalid check digit or length" };
  }
  const parsed = parseGs1(code);
  if (parsed.ok) return { kind: "gs1", parsed };
  return { kind: "unknown", reason: parsed.errors[0] ?? "unrecognised" };
}
