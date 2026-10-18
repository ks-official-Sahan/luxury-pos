import { describe, expect, it } from "vitest";
import { buildEmvcoPayload, createQrAdapter, crc16ccitt, formatAmount, type QrMerchantConfig } from "./adapters/qr";

/** Independent reference: table-driven CRC-16/CCITT-FALSE. */
function refCrc(s: string): string {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1;
    table.push(c & 0xffff);
  }
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(s)) crc = ((crc << 8) & 0xffff) ^ (table[((crc >> 8) ^ b) & 0xff] ?? 0);
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parse(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    expect(Number.isInteger(len)).toBe(true);
    const val = s.slice(i + 4, i + 4 + len);
    expect(val.length).toBe(len);
    out.push([id, val]);
    i += 4 + len;
  }
  expect(i).toBe(s.length);
  return out;
}

const merchant: QrMerchantConfig = {
  guid: "lk.lankaqr", merchantId: "M123456", mcc: "5411", country: "lk", merchantName: "Luxury Boutique Colombo Flagship Store", city: "Colombo 03 Western", terminalId: "T01",
};

describe("crc16ccitt", () => {
  it("matches the standard check value", () => {
    expect(crc16ccitt("123456789")).toBe("29B1");
    expect(refCrc("123456789")).toBe("29B1");
  });
  it("matches reference on random inputs", () => {
    let seed = 7;
    for (let n = 0; n < 50; n++) {
      let s = "";
      for (let k = 0; k < n + 1; k++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; s += String.fromCharCode(32 + (seed % 95)); }
      expect(crc16ccitt(s)).toBe(refCrc(s));
    }
  });
});

describe("buildEmvcoPayload", () => {
  const payload = buildEmvcoPayload({ merchant, amount: 125_050, currency: "LKR", billNumber: "ORD-1001" });
  const fields = parse(payload);
  const get = (id: string) => fields.find(([k]) => k === id)?.[1];

  it("ends with a correct CRC over the payload including 6304", () => {
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toBe(refCrc(payload.slice(0, -4)));
    expect(fields[fields.length - 1]?.[0]).toBe("63");
  });
  it("has well-formed TLV with required fields in order", () => {
    expect(fields.map(([k]) => k)).toEqual(["00", "01", "26", "52", "53", "54", "58", "59", "60", "62", "63"]);
    expect(get("00")).toBe("01");
    expect(get("01")).toBe("12");
    expect(get("52")).toBe("5411");
    expect(get("53")).toBe("144");
    expect(get("54")).toBe("1250.50");
    expect(get("58")).toBe("LK");
  });
  it("truncates name to 25 and city to 15", () => {
    expect(get("59")).toBe("Luxury Boutique Colombo F");
    expect(get("59")?.length).toBe(25);
    expect(get("60")).toBe("Colombo 03 West");
  });
  it("encodes account template and additional data", () => {
    expect(parse(get("26") ?? "")).toEqual([["00", "lk.lankaqr"], ["01", "M123456"]]);
    expect(parse(get("62") ?? "")).toEqual([["01", "ORD-1001"], ["07", "T01"]]);
  });
  it("formats JPY without decimals and USD with two", () => {
    expect(formatAmount(1500, "JPY")).toBe("1500");
    expect(formatAmount(1500, "USD")).toBe("15.00");
    expect(formatAmount(5, "USD")).toBe("0.05");
    const jpy = parse(buildEmvcoPayload({ merchant, amount: 1500, currency: "JPY" }));
    expect(jpy.find(([k]) => k === "54")?.[1]).toBe("1500");
    expect(jpy.find(([k]) => k === "53")?.[1]).toBe("392");
  });
  it("maps all documented currencies", () => {
    const exp: Record<string, string> = { LKR: "144", USD: "840", EUR: "978", GBP: "826", INR: "356", AED: "784", SGD: "702", THB: "764", MYR: "458", IDR: "360", JPY: "392", AUD: "036" };
    for (const [c, n] of Object.entries(exp)) {
      expect(parse(buildEmvcoPayload({ merchant, amount: 100, currency: c })).find(([k]) => k === "53")?.[1]).toBe(n);
    }
  });
  it("rejects unsupported currency and bad config", () => {
    expect(() => buildEmvcoPayload({ merchant, amount: 1, currency: "XXX" })).toThrow(RangeError);
    expect(() => buildEmvcoPayload({ merchant: { ...merchant, mcc: "12" }, amount: 1, currency: "USD" })).toThrow(RangeError);
    expect(() => buildEmvcoPayload({ merchant: { ...merchant, templateId: "52" }, amount: 1, currency: "USD" })).toThrow(RangeError);
  });
});

describe("qr adapter", () => {
  const qr = createQrAdapter({ merchant });
  it("returns a qr action requiring later confirmation", async () => {
    const r = await qr.create({ idempotencyKey: "k1", tenantId: "t", storeId: "s", orderId: "o-1", amount: 2000, currency: "LKR", method: "qr", metadata: {} });
    expect(r.status).toBe("requires_action");
    expect(r.action?.kind).toBe("qr");
    expect(r.action?.payload.slice(-4)).toBe(refCrc((r.action?.payload ?? "").slice(0, -4)));
    expect(r.providerRef).toBe("qr:k1");
  });
  it("fails on unsupported currency; refunds are pending", async () => {
    const r = await qr.create({ idempotencyKey: "k1", tenantId: "t", storeId: "s", amount: 2000, currency: "CHF", method: "qr", metadata: {} });
    expect(r.failureCode).toBe("unsupported_currency");
    expect(qr.supportsCurrency("CHF")).toBe(false);
    expect((await qr.refund("qr:k1", 1, "rk")).status).toBe("pending");
  });
});
