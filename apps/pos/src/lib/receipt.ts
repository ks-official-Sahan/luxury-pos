import { Platform } from "react-native";
import { formatMoney } from "@luxury-pos/core";
import type { BrandTheme } from "@luxury-pos/theme";

export interface ReceiptData {
  receiptNo: string | null;
  storeName: string;
  currency: string;
  lines: { name: string; quantity: number; total: number }[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  changeDue: number;
  createdAt: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Thermal-printer HTML (58/80 mm) in the store's brand: name, fonts, header and footer from the theme. */
export function receiptHtml(r: ReceiptData, theme: BrandTheme): string {
  const m = (v: number) => esc(formatMoney(v, r.currency));
  const width = theme.receipt.paperWidthMm;
  const rows = r.lines.map((l) => `<tr><td>${l.quantity} × ${esc(l.name)}</td><td class="r">${m(l.total)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${width}mm auto; margin: 0 }
body { width: ${width - 6}mm; margin: 3mm; font: 11px/1.4 "${esc(theme.fonts.body.family)}", system-ui, sans-serif; color: #000 }
h1 { font: 600 16px/1.2 "${esc(theme.fonts.display.family)}", Georgia, serif; text-align: center; margin: 0 0 4px }
.c { text-align: center } .r { text-align: right; white-space: nowrap } table { width: 100%; border-collapse: collapse }
td { padding: 1px 0; vertical-align: top } .t td { border-top: 1px dashed #000; padding-top: 4px; font-weight: 600 }
</style></head><body>
<h1>${esc(theme.name)}</h1><div class="c">${esc(r.storeName)}</div>
${theme.receipt.header ? `<p class="c">${esc(theme.receipt.header)}</p>` : ""}
<p class="c">${esc(new Date(r.createdAt).toLocaleString())}${r.receiptNo ? `<br>${esc(r.receiptNo)}` : "<br>Pending sync"}</p>
<table>${rows}
<tr><td>Subtotal</td><td class="r">${m(r.subtotal)}</td></tr>
${r.discountTotal ? `<tr><td>Discounts</td><td class="r">-${m(r.discountTotal)}</td></tr>` : ""}
<tr><td>Tax</td><td class="r">${m(r.taxTotal)}</td></tr>
<tr class="t"><td>Total</td><td class="r">${m(r.total)}</td></tr>
${r.changeDue ? `<tr><td>Change</td><td class="r">${m(r.changeDue)}</td></tr>` : ""}
</table>
${theme.receipt.footer ? `<p class="c">${esc(theme.receipt.footer)}</p>` : ""}
</body></html>`;
}

declare global {
  interface Window {
    posDesktop?: { print(html: string, printer?: string): Promise<{ ok: boolean; reason: string | null }> };
  }
}

/** Desktop: silent print through the Electron bridge. Browser: print dialog from a hidden frame. */
export async function printReceipt(html: string): Promise<boolean> {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  if (window.posDesktop) return (await window.posDesktop.print(html)).ok;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0";
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await new Promise((r) => (frame.onload = r));
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 1_000);
  return true;
}
