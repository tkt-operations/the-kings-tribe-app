/**
 * Exact money arithmetic using integer cents (BigInt).
 *
 * The DATABASE is the authority for every stored total (PostgreSQL numeric).
 * This module exists so the browser can show live previews and so server code
 * can aggregate numeric strings returned by PostgreSQL without ever using
 * floating point.
 */

const MONEY_PATTERN = /^(-)?(\d{1,11})(?:\.(\d{1,2}))?$/;
const QUANTITY_PATTERN = /^(\d{1,6})(?:\.(\d{1,2}))?$/;

export type Cents = bigint;

/** Parse "12.34", "12", "-0.5", "1,234.50" into cents. Returns null if invalid. */
export function parseMoney(input: string | number | null | undefined, { allowNegative = false } = {}): Cents | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(/,/g, "").replace(/^\$/, "");
  if (text === "") return null;
  const match = MONEY_PATTERN.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (sign && !allowNegative) return null;
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  return sign ? -cents : cents;
}

/** Parse a quantity with up to 2 decimals into hundredths. Must be > 0. */
export function parseQuantity(input: string | number | null | undefined): bigint | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(/,/g, "");
  const match = QUANTITY_PATTERN.exec(text);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  const hundredths = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  return hundredths > 0n ? hundredths : null;
}

/** Same rounding as PostgreSQL round(numeric, 2): half away from zero. */
function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n + d / 2n) / d;
  return negative ? -q : q;
}

/** line total = round(quantity × unit price, 2) — identical to the database rule. */
export function lineTotal(quantityHundredths: bigint, unitPriceCents: Cents): Cents {
  return divRoundHalfAwayFromZero(quantityHundredths * unitPriceCents, 100n);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Convert a PostgreSQL numeric string (e.g. "1234.5" or "-3") into cents. */
export function numericToCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === "") return 0n;
  const parsed = parseMoney(String(value), { allowNegative: true });
  if (parsed === null) throw new Error(`Invalid numeric value: ${value}`);
  return parsed;
}

/** Cents to a plain decimal string ("1234.50"), suitable for sending to the database. */
export function centsToDecimal(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function quantityToDecimal(hundredths: bigint): string {
  const whole = hundredths / 100n;
  const fraction = hundredths % 100n;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`;
}

/** Format cents for display, e.g. $1,234.50. Uses Intl only for grouping/symbols. */
export function formatCents(cents: Cents, currency = "USD", locale = "en-US"): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = Number(abs % 100n);
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(1234567.89);
  const symbolParts = parts.filter((p) => p.type === "currency" || p.type === "literal");
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const number = `${wholeText}${decimal}${fraction.toString().padStart(2, "0")}`;
  const currencyIndex = parts.findIndex((p) => p.type === "currency");
  const integerIndex = parts.findIndex((p) => p.type === "integer");
  const symbol = symbolParts.filter((p) => p.type === "currency").map((p) => p.value).join("");
  const literal = parts.find((p) => p.type === "literal")?.value ?? "";
  const formatted = currencyIndex < integerIndex ? `${symbol}${literal}${number}` : `${number}${literal}${symbol}`;
  return negative ? `-${formatted}` : formatted;
}

/** Format a PostgreSQL numeric string as currency. */
export function formatMoney(value: string | number | null | undefined, currency = "USD"): string {
  return formatCents(numericToCents(value ?? 0), currency);
}

/** Display-only conversion for charts. Never use the result for arithmetic that is stored. */
export function centsToChartNumber(cents: Cents): number {
  return Number(cents) / 100;
}
