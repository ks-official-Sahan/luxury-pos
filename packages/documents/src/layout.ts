import { computeTotals } from "./totals";
import type { DocLine, DocType } from "./types";

export type BlockKind = "text" | "logo" | "address" | "taxId" | "qr" | "barcode" | "divider";
export type Align = "left" | "center" | "right";
export interface Block { kind: BlockKind; value?: string; align: Align }

export interface DocumentTemplate {
  id: string;
  docType: DocType;
  paper: "80mm" | "58mm" | "A4" | "A5" | "letter";
  letterhead?: { imageUrl: string; position: "top" | "background"; heightMm: number };
  header: Block[];
  footer: Block[];
  showQrFor?: "receipt_lookup" | "payment" | "none";
  fields: { showTaxBreakdown: boolean; showSku: boolean; showSerial: boolean; showCashier: boolean; showLoyalty: boolean };
  notes?: string;
}

/** Everything a renderer needs; totals are always recomputed from lines so print never disagrees with the ledger. */
export interface RenderableDocument {
  docType: DocType;
  number: string;
  issuedAt: string;
  currency: string;
  /** Minor unit digits, default 2. */
  currencyDecimals?: number;
  lines: DocLine[];
  customerName?: string;
  cashier?: string;
  dueDate?: string;
  paidMinor?: number;
  loyalty?: { earned: number; balance: number };
  lookupUrl?: string;
  paymentUrl?: string;
}

export interface Brand { name: string; primaryColor: string; fontFamily: string }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Integer minor units -> "12.34" without floating point. */
export function formatMinor(minor: number, decimals = 2): string {
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(decimals + 1, "0");
  const body = decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
  return neg ? `-${body}` : body;
}

function formatPpm(ppm: number): string {
  const whole = Math.floor(ppm / 10_000);
  const frac = String(ppm % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}%` : `${whole}%`;
}

const fmtQty = (q: number) => String(Math.round(q * 1000) / 1000);
const DOC_TITLE: Record<DocType, string> = {
  quotation: "QUOTATION", sales_order: "SALES ORDER", invoice: "INVOICE", receipt: "RECEIPT", credit_note: "CREDIT NOTE",
  return: "RETURN", purchase_order: "PURCHASE ORDER", delivery_note: "DELIVERY NOTE",
};

// ---------- thermal text ----------

/** Printer control characters (ESC sequences, tabs, CR) from user text become spaces. */
const clean = (s: string) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let cur = "";
    for (const word of para.split(/ +/).filter(Boolean)) {
      let w = Array.from(word);
      while (w.length > width) {
        if (cur) { out.push(cur); cur = ""; }
        out.push(w.slice(0, width).join(""));
        w = w.slice(width);
      }
      const piece = w.join("");
      if (!cur) cur = piece;
      else if (cur.length + 1 + piece.length <= width) cur += " " + piece;
      else { out.push(cur); cur = piece; }
    }
    out.push(cur);
  }
  return out;
}

function align(line: string, width: number, a: Align): string {
  if (a === "right") return line.padStart(width);
  if (a === "center") return " ".repeat(Math.floor((width - line.length) / 2)) + line;
  return line;
}

function twoCol(left: string, right: string, width: number): string {
  const r = right.length >= width ? right.slice(0, width) : right;
  const avail = Math.max(0, width - r.length - 1);
  return left.slice(0, avail).padEnd(avail) + (avail > 0 ? " " : "") + r;
}

function textBlock(b: Block, width: number, label: string): string[] {
  switch (b.kind) {
    case "divider": return ["-".repeat(width)];
    case "logo": return []; // images are not printable as text
    case "text": case "address": return b.value ? wrap(b.value, width).map((l) => align(l, width, b.align)) : [];
    case "taxId": return b.value ? wrap(`Tax ID: ${b.value}`, width).map((l) => align(l, width, b.align)) : [];
    case "qr": case "barcode": return b.value ? wrap(`[${label}] ${b.value}`, width).map((l) => align(l, width, b.align)) : [];
  }
}

/** Monospace receipt for thermal printers. Invariant: no output line exceeds widthChars (min 16). */
export function renderReceiptText(doc: RenderableDocument, tpl: DocumentTemplate, widthChars: number): string {
  const w = Math.max(16, Math.floor(widthChars));
  const dec = doc.currencyDecimals ?? 2;
  const money = (n: number) => formatMinor(n, dec);
  const t = computeTotals(doc.lines);
  const out: string[] = [];
  for (const b of tpl.header) out.push(...textBlock(b, w, b.kind === "qr" ? "QR" : "BARCODE"));
  out.push(align(DOC_TITLE[doc.docType], w, "center"));
  out.push(...wrap(`No: ${doc.number}`, w), ...wrap(`Date: ${doc.issuedAt}`, w));
  if (tpl.fields.showCashier && doc.cashier) out.push(...wrap(`Cashier: ${doc.cashier}`, w));
  if (doc.customerName) out.push(...wrap(`Customer: ${doc.customerName}`, w));
  out.push("-".repeat(w));
  doc.lines.forEach((l, i) => {
    const a = t.lines[i]!;
    out.push(...wrap(l.description, w));
    if (tpl.fields.showSku && l.sku) out.push(...wrap(`SKU: ${l.sku}`, w - 2).map((x) => "  " + x));
    if (tpl.fields.showSerial && l.serial) out.push(...wrap(`S/N: ${l.serial}`, w - 2).map((x) => "  " + x));
    out.push(twoCol(`  ${fmtQty(l.quantity)}${l.uom ? " " + clean(l.uom) : ""} x ${money(l.unitPrice)}`, money(a.grossMinor), w));
    if (a.discountMinor > 0) out.push(twoCol(`  Discount`, `-${money(a.discountMinor)}`, w));
  });
  out.push("-".repeat(w));
  out.push(twoCol("Subtotal", money(t.subtotalMinor), w));
  if (tpl.fields.showTaxBreakdown) {
    for (const r of t.taxBreakdown) out.push(twoCol(`Tax ${formatPpm(r.taxPpm)} on ${money(r.baseMinor)}`, money(r.taxMinor), w));
  } else {
    out.push(twoCol("Tax", money(t.taxMinor), w));
  }
  out.push(twoCol(`TOTAL ${clean(doc.currency)}`, money(t.totalMinor), w));
  if (doc.paidMinor !== undefined) {
    out.push(twoCol("Paid", money(doc.paidMinor), w));
    out.push(twoCol(doc.paidMinor > t.totalMinor ? "Change" : "Balance", money(Math.abs(t.totalMinor - doc.paidMinor)), w));
  }
  if (doc.dueDate) out.push(...wrap(`Due: ${doc.dueDate}`, w));
  if (tpl.fields.showLoyalty && doc.loyalty) {
    out.push(twoCol("Points earned", String(doc.loyalty.earned), w), twoCol("Points balance", String(doc.loyalty.balance), w));
  }
  if (tpl.notes) { out.push("-".repeat(w), ...wrap(tpl.notes, w)); }
  const qr = qrValue(doc, tpl);
  if (qr) out.push(...wrap(`[QR] ${qr}`, w).map((l) => align(l, w, "center")));
  for (const b of tpl.footer) out.push(...textBlock(b, w, b.kind === "qr" ? "QR" : "BARCODE"));
  return out.map((l) => l.replace(/\s+$/, "")).join("\n");
}

function qrValue(doc: RenderableDocument, tpl: DocumentTemplate): string | undefined {
  if (tpl.showQrFor === "receipt_lookup") return doc.lookupUrl;
  if (tpl.showQrFor === "payment") return doc.paymentUrl;
  return undefined;
}

// ---------- HTML ----------

const PAPER_CSS: Record<DocumentTemplate["paper"], { size: string; width: string }> = {
  "80mm": { size: "80mm auto", width: "80mm" }, "58mm": { size: "58mm auto", width: "58mm" },
  A4: { size: "A4", width: "210mm" }, A5: { size: "A5", width: "148mm" }, letter: { size: "letter", width: "215.9mm" },
};

const safeColor = (c: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "#111111");
const safeFont = (f: string) => f.replace(/[^A-Za-z0-9 ,\-_]/g, "").trim() || "sans-serif";
/** Only http(s) and raster data URIs are allowed as image sources; anything else is dropped. */
const safeUrl = (u: string) => (/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(u) ? u : "");

function htmlBlock(b: Block): string {
  const style = `text-align:${b.align}`;
  const v = escapeHtml(b.value ?? "");
  switch (b.kind) {
    case "divider": return `<hr>`;
    case "logo": { const u = safeUrl(b.value ?? ""); return u ? `<div style="${style}"><img class="logo" src="${escapeHtml(u)}" alt=""></div>` : ""; }
    case "text": return b.value ? `<p style="${style}">${v.replace(/\n/g, "<br>")}</p>` : "";
    case "address": return b.value ? `<address style="${style}">${v.replace(/\n/g, "<br>")}</address>` : "";
    case "taxId": return b.value ? `<p style="${style}">Tax ID: ${v}</p>` : "";
    case "qr": return b.value ? `<div class="qr" style="${style}" data-qr="${v}">${v}</div>` : "";
    case "barcode": return b.value ? `<div class="barcode" style="${style}" data-barcode="${v}">${v}</div>` : "";
  }
}

/** Full standalone HTML page. Every user supplied string is escaped; colors, fonts and URLs are allow-list sanitised. */
export function renderHtml(doc: RenderableDocument, tpl: DocumentTemplate, brand: Brand): string {
  const dec = doc.currencyDecimals ?? 2;
  const money = (n: number) => escapeHtml(formatMinor(n, dec));
  const t = computeTotals(doc.lines);
  const paper = PAPER_CSS[tpl.paper];
  const color = safeColor(brand.primaryColor);
  const lh = tpl.letterhead;
  const lhUrl = lh ? safeUrl(lh.imageUrl) : "";
  const lhHeight = lh ? Math.max(0, Math.min(100, Number(lh.heightMm) || 0)) : 0;
  const lhHtml = lh && lhUrl
    ? lh.position === "top"
      ? `<img class="letterhead" src="${escapeHtml(lhUrl)}" alt="" style="height:${lhHeight}mm">`
      : `<img class="letterhead bg" src="${escapeHtml(lhUrl)}" alt="" style="height:${lhHeight}mm">`
    : "";
  const cols = 3 + (tpl.fields.showSku ? 1 : 0);
  const rows = doc.lines.map((l, i) => {
    const a = t.lines[i]!;
    const extra = [
      tpl.fields.showSku && l.sku ? `SKU ${escapeHtml(l.sku)}` : "",
      tpl.fields.showSerial && l.serial ? `S/N ${escapeHtml(l.serial)}` : "",
    ].filter(Boolean).join(" &middot; ");
    return `<tr><td>${escapeHtml(l.description)}${extra ? `<div class="sub">${extra}</div>` : ""}</td>` +
      (tpl.fields.showSku ? `<td>${escapeHtml(l.sku ?? "")}</td>` : "") +
      `<td class="n">${escapeHtml(fmtQty(l.quantity))}${l.uom ? " " + escapeHtml(l.uom) : ""} &times; ${money(l.unitPrice)}</td>` +
      `<td class="n">${money(a.netMinor)}</td></tr>`;
  }).join("");
  const taxRows = tpl.fields.showTaxBreakdown
    ? t.taxBreakdown.map((r) => `<tr><td colspan="${cols - 1}">Tax ${escapeHtml(formatPpm(r.taxPpm))} on ${money(r.baseMinor)}</td><td class="n">${money(r.taxMinor)}</td></tr>`).join("")
    : `<tr><td colspan="${cols - 1}">Tax</td><td class="n">${money(t.taxMinor)}</td></tr>`;
  const qr = qrValue(doc, tpl);
  const meta = [
    `<div><strong>${escapeHtml(DOC_TITLE[doc.docType])}</strong> ${escapeHtml(doc.number)}</div>`,
    `<div>Date: ${escapeHtml(doc.issuedAt)}</div>`,
    doc.dueDate ? `<div>Due: ${escapeHtml(doc.dueDate)}</div>` : "",
    doc.customerName ? `<div>Customer: ${escapeHtml(doc.customerName)}</div>` : "",
    tpl.fields.showCashier && doc.cashier ? `<div>Cashier: ${escapeHtml(doc.cashier)}</div>` : "",
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(DOC_TITLE[doc.docType])} ${escapeHtml(doc.number)}</title><style>
@page{size:${paper.size};margin:12mm}
body{margin:0;font-family:${safeFont(brand.fontFamily)};color:#111;font-size:11pt}
.page{position:relative;width:${paper.width};max-width:100%;margin:0 auto;padding:8mm;box-sizing:border-box}
.brand{color:${color};font-size:18pt;font-weight:700;margin:0 0 4mm}
.letterhead{display:block;width:100%;object-fit:contain}
.letterhead.bg{position:absolute;left:0;top:0;z-index:-1;opacity:.12}
.logo{max-height:20mm}
table{width:100%;border-collapse:collapse;margin-top:4mm}
th{background:${color};color:#fff;text-align:left;padding:2mm}
td{padding:2mm;border-bottom:1px solid #ddd;vertical-align:top}
.n{text-align:right;white-space:nowrap}.sub{font-size:9pt;color:#555}
.total td{font-weight:700;border-top:2px solid ${color}}
</style></head><body><div class="page">${lhHtml}<h1 class="brand">${escapeHtml(brand.name)}</h1>${tpl.header.map((b) => htmlBlock(b)).join("")}${meta}
<table><thead><tr><th>Item</th>${tpl.fields.showSku ? "<th>SKU</th>" : ""}<th class="n">Qty &times; Price</th><th class="n">Amount</th></tr></thead><tbody>${rows}
<tr><td colspan="${cols - 1}">Subtotal</td><td class="n">${money(t.subtotalMinor)}</td></tr>${taxRows}
<tr class="total"><td colspan="${cols - 1}">Total ${escapeHtml(doc.currency)}</td><td class="n">${money(t.totalMinor)}</td></tr></tbody></table>
${tpl.fields.showLoyalty && doc.loyalty ? `<p>Points earned: ${doc.loyalty.earned} &middot; balance: ${doc.loyalty.balance}</p>` : ""}
${tpl.notes ? `<p class="notes">${escapeHtml(tpl.notes).replace(/\n/g, "<br>")}</p>` : ""}
${qr ? `<div class="qr" data-qr="${escapeHtml(qr)}">${escapeHtml(qr)}</div>` : ""}${tpl.footer.map((b) => htmlBlock(b)).join("")}</div></body></html>`;
}
