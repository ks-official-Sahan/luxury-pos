export const MIN_CLIENT_QUERY = 2;

/** The API masks contact details the caller may not see: "a•••@x.com" and "•••123". */
export function isMasked(value: string | null | undefined): boolean {
  return !!value && value.includes("•");
}

export interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  tierId: string | null;
  pointsBalance: number;
  lifetimeSpend: number;
  lastPurchaseAt: string | null;
}

export interface ClientRecord extends ClientSummary {
  birthday: string | null;
  preferences: Record<string, string>;
  notes: string | null;
  marketingConsent: boolean;
  createdAt: string;
}

export type PurchaseStatus = "completed" | "partially_refunded" | "refunded" | "voided";

export interface Purchase {
  id: string;
  receiptNo: string;
  total: number;
  createdAt: string;
  status: PurchaseStatus;
  lines: { name: string; sku: string; quantity: number; total: number }[];
}

export interface ClientProfile {
  customer: ClientRecord;
  recent: Purchase[];
}

export function clientName(c: { firstName: string; lastName: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ");
}

export function tierLabel(tierId: string | null): string {
  return tierId ? tierId.charAt(0).toUpperCase() + tierId.slice(1) : "Member";
}

/** Dates follow the device language like every other screen (see lib/format); `_locale` is kept for callers. */
export function formatDay(iso: string | null, _locale?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------- form model */

export interface PreferenceRow {
  uid: number;
  key: string;
  value: string;
}

export interface ClientFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthday: string;
  notes: string;
  marketingConsent: boolean;
  preferences: PreferenceRow[];
}

export interface ClientFormErrors {
  firstName?: string;
  email?: string;
  birthday?: string;
  preferences?: string;
}

export interface ClientPayload {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  birthday?: string;
  notes?: string;
  marketingConsent: boolean;
  preferences: Record<string, string>;
}

let rowSeq = 0;

export function newPreferenceRow(key = "", value = ""): PreferenceRow {
  rowSeq += 1;
  return { uid: rowSeq, key, value };
}

export function initialClientForm(c: ClientRecord | null): ClientFormValues {
  return {
    firstName: c?.firstName ?? "",
    lastName: c?.lastName ?? "",
    // Masked values are shown as a hint, never loaded into the field, so they cannot be saved back.
    email: isMasked(c?.email) ? "" : (c?.email ?? ""),
    phone: isMasked(c?.phone) ? "" : (c?.phone ?? ""),
    birthday: c?.birthday ?? "",
    notes: c?.notes ?? "",
    marketingConsent: c?.marketingConsent ?? false,
    preferences: Object.entries(c?.preferences ?? {}).map(([key, value]) => newPreferenceRow(key, value)),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isPastDay(day: string, now: Date): boolean {
  if (!DAY.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day && d.getTime() <= now.getTime();
}

export function validateClientForm(v: ClientFormValues, now: Date = new Date()): ClientFormErrors {
  const errors: ClientFormErrors = {};
  if (!v.firstName.trim()) errors.firstName = "Enter a first name.";
  const email = v.email.trim();
  if (email && !EMAIL.test(email)) errors.email = "Enter an email like name@example.com.";
  const day = v.birthday.trim();
  if (day && !isPastDay(day, now)) errors.birthday = "Use YYYY-MM-DD for a date in the past.";
  const named = v.preferences.map((p) => p.key.trim()).filter(Boolean);
  if (v.preferences.some((p) => !p.key.trim() && p.value.trim())) errors.preferences = "Each preference needs a name.";
  else if (v.preferences.some((p) => p.key.trim() && !p.value.trim())) errors.preferences = "Each preference needs a value.";
  else if (new Set(named).size !== named.length) errors.preferences = "Preference names must be different.";
  return errors;
}

/**
 * Edit semantics: empty text clears a stored value, except a masked value the caller could
 * not see in full, which is left alone so a partial view never overwrites the real one.
 */
function clearable(value: string, stored: string | null): string | undefined {
  const next = value.trim();
  if (next) return next;
  return stored && !isMasked(stored) ? "" : undefined;
}

export function buildClientPayload(v: ClientFormValues, original: ClientRecord | null): ClientPayload {
  return {
    firstName: v.firstName.trim(),
    lastName: clearable(v.lastName, original?.lastName ?? null),
    email: v.email.trim() || undefined,
    phone: clearable(v.phone, original?.phone ?? null),
    birthday: v.birthday.trim() || undefined,
    notes: clearable(v.notes, original?.notes ?? null),
    marketingConsent: v.marketingConsent,
    preferences: Object.fromEntries(v.preferences.filter((p) => p.key.trim() && p.value.trim()).map((p) => [p.key.trim(), p.value.trim()])),
  };
}
