import { parseMoney, quantityToDecimal } from "@/lib/money";

/** Quantity strings from the database ("2.50") as exact hundredths. */
export function hundredths(value: string | null | undefined): bigint {
  if (!value) return 0n;
  return parseMoney(String(value), { allowNegative: true }) ?? 0n;
}

export function showQty(h: bigint): string {
  return h <= 0n ? "0" : quantityToDecimal(h);
}
