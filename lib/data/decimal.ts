/**
 * PostgreSQL `numeric` values reach the app in two shapes: PostgREST
 * (supabase-js) returns them as JSON numbers (1, 2.5, 1360), while our SQL
 * functions return them as text ("1.00"). The app's canonical shape for every
 * quantity and amount is a decimal STRING, which lib/money parses exactly into
 * integer cents/hundredths. Normalise at the data boundary so components never
 * receive a number.
 *
 * Precision: columns are numeric(12,2)/numeric(14,2), i.e. at most 2 decimals
 * and well below 2^53, so a JSON number is exact to the cent and String(n)
 * reproduces it ("1.1" for 1.10). Exponent notation is expanded explicitly.
 */
export function decimalString(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value: ${value}`);
    const text = String(value);
    return /e/i.test(text) ? value.toFixed(2) : text;
  }
  return value;
}

/** As decimalString, but keeps NULL for optional numeric columns. */
export function decimalOrNull(value: string | number | bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : decimalString(value);
}

/** Return a copy of `row` with the listed numeric keys as decimal strings. */
export function withDecimals<T extends Record<string, unknown>>(row: T, required: readonly string[], optional: readonly string[] = []): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of required) if (key in row) out[key] = decimalString(row[key] as string | number | null);
  for (const key of optional) if (key in row) out[key] = decimalOrNull(row[key] as string | number | null);
  return out as T;
}
