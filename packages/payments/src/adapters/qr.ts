import type { AdapterResult, PaymentAdapter, RefundResult } from "../adapter";
import type { CreateInput } from "../types";

/** ISO 4217 numeric codes for supported currencies. */
export const CURRENCY_NUMERIC: Readonly<Record<string, string>> = {
  LKR: "144",
  USD: "840",
  EUR: "978",
  GBP: "826",
  INR: "356",
  AED: "784",
  SGD: "702",
  THB: "764",
  MYR: "458",
  IDR: "360",
  JPY: "392",
  AUD: "036",
};

/** Currencies with zero minor-unit exponent. */
const ZERO_DECIMAL = new Set(["JPY"]);

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no xor-out. Returns 4 upper-case hex chars. */
export function crc16ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Encodes one TLV: 2-digit id, 2-digit length, value. Value length is capped at 99 by EMVCo. */
export function tlv(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`EMV field ${id} exceeds 99 chars`);
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

/** Minor units to EMV decimal string using the currency exponent (JPY 0, others 2). */
export function formatAmount(minor: number, currency: string): string {
  if (ZERO_DECIMAL.has(currency.toUpperCase())) return String(minor);
  const whole = Math.trunc(minor / 100);
  const frac = String(minor % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

const ascii = (s: string, max: number): string =>
  s.replace(/[^\x20-\x7E]/g, "").trim().slice(0, max);

export interface QrMerchantConfig {
  /** Globally unique id of the scheme, e.g. "lk.lankaqr". Sub-field 00 of the account template. */
  guid: string;
  /** Merchant id at the scheme. Sub-field 01. */
  merchantId: string;
  /** Template tag 26-51. Default "26". */
  templateId?: string;
  /** Merchant category code, 4 digits. */
  mcc: string;
  /** ISO 3166 alpha-2. */
  country: string;
  /** Max 25 chars. */
  merchantName: string;
  /** Max 15 chars. */
  city: string;
  terminalId?: string;
}

export interface QrPayloadInput {
  merchant: QrMerchantConfig;
  amount: number;
  currency: string;
  billNumber?: string;
  terminalId?: string;
}

/** Builds a dynamic (point of initiation "12") EMVCo merchant-presented QR payload ending in CRC. */
export function buildEmvcoPayload(input: QrPayloadInput): string {
  const m = input.merchant;
  const numeric = CURRENCY_NUMERIC[input.currency.toUpperCase()];
  if (!numeric) throw new RangeError(`unsupported currency ${input.currency}`);
  const tplId = m.templateId ?? "26";
  const tplNum = Number(tplId);
  if (!/^\d{2}$/.test(tplId) || tplNum < 26 || tplNum > 51) throw new RangeError("templateId must be 26-51");
  if (!/^\d{4}$/.test(m.mcc)) throw new RangeError("mcc must be 4 digits");
  if (!/^[A-Za-z]{2}$/.test(m.country)) throw new RangeError("country must be alpha-2");

  const additional: string[] = [];
  const bill = input.billNumber ? ascii(input.billNumber, 25) : "";
  if (bill) additional.push(tlv("01", bill));
  const term = ascii(input.terminalId ?? m.terminalId ?? "", 25);
  if (term) additional.push(tlv("07", term));

  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv(tplId, tlv("00", ascii(m.guid, 32)) + tlv("01", ascii(m.merchantId, 32))) +
    tlv("52", m.mcc) +
    tlv("53", numeric) +
    tlv("54", formatAmount(input.amount, input.currency)) +
    tlv("58", m.country.toUpperCase()) +
    tlv("59", ascii(m.merchantName, 25)) +
    tlv("60", ascii(m.city, 15)) +
    (additional.length > 0 ? tlv("62", additional.join("")) : "");
  const withCrcHeader = `${body}6304`;
  return withCrcHeader + crc16ccitt(withCrcHeader);
}

export interface QrAdapterConfig {
  id?: string;
  merchant: QrMerchantConfig;
}

/**
 * QR adapter: returns a `requires_action` qr payload. Confirmation arrives later (bank webhook or manual
 * confirm by staff) and is applied via the state machine. Refunds are settled out of band, so `pending`.
 */
export function createQrAdapter(config: QrAdapterConfig): PaymentAdapter {
  const id = config.id ?? "qr";
  return {
    id,
    methods: ["qr"],
    supportsCurrency: (c) => c.toUpperCase() in CURRENCY_NUMERIC,
    async create(input: CreateInput): Promise<AdapterResult> {
      if (!(input.currency.toUpperCase() in CURRENCY_NUMERIC)) return { status: "failed", failureCode: "unsupported_currency" };
      const payload = buildEmvcoPayload({
        merchant: config.merchant,
        amount: input.amount,
        currency: input.currency,
        billNumber: (input.orderId ?? input.idempotencyKey).replace(/[^A-Za-z0-9-]/g, ""),
        ...(input.metadata["terminalId"] ? { terminalId: input.metadata["terminalId"] } : {}),
      });
      return { status: "requires_action", providerRef: `${id}:${input.idempotencyKey}`, action: { kind: "qr", payload } };
    },
    async refund(ref: string, _amount: number, idempotencyKey: string): Promise<RefundResult> {
      return { status: "pending", providerRef: `${ref}:refund:${idempotencyKey}` };
    },
  };
}
