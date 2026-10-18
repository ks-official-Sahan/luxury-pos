/**
 * Deterministic JSON for hashing and signing: object keys sorted recursively (code unit order), no whitespace,
 * Date -> ISO string, undefined object members dropped, non-finite numbers rejected.
 * Same logical value always yields the same string regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return ser(value, new Set());
}

function ser(v: unknown, seen: Set<object>): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string": return JSON.stringify(v);
    case "boolean": return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(v);
    case "bigint": throw new TypeError("canonicalJson: bigint unsupported");
    case "undefined": case "function": case "symbol":
      throw new TypeError(`canonicalJson: unsupported ${typeof v}`);
  }
  const o = v as object;
  if (o instanceof Date) {
    if (Number.isNaN(o.getTime())) throw new TypeError("canonicalJson: invalid Date");
    return JSON.stringify(o.toISOString());
  }
  if (seen.has(o)) throw new TypeError("canonicalJson: circular reference");
  seen.add(o);
  try {
    if (Array.isArray(o)) {
      return "[" + o.map((x) => (x === undefined ? "null" : ser(x, seen))).join(",") + "]";
    }
    const rec = o as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of Object.keys(rec).sort()) {
      const x = rec[k];
      if (x === undefined) continue;
      parts.push(JSON.stringify(k) + ":" + ser(x, seen));
    }
    return "{" + parts.join(",") + "}";
  } finally {
    seen.delete(o);
  }
}
