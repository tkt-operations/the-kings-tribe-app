/**
 * Chart palette — official brand colors only, in a fixed order chosen with the
 * data-viz palette validator for the best colour-vision-deficiency separation
 * (adjacent ΔE ≥ 9.6 protan). Because brand rules forbid new hues, the colours
 * sit outside the validator's generic lightness/chroma bands; every multi-series
 * chart therefore ships with a legend, direct labels where useful, and a table view.
 */
export const SERIES_COLORS = [
  "#3166DD", // Ministry Blue
  "#FD5820", // Energy Orange
  "#0D7050", // Kingdom Green
  "#12172D", // Deep Navy
  "#F3C94A", // Royal Gold (low contrast on white: always labelled)
] as const;

export const OTHER_COLOR = "rgba(18, 23, 45, 0.28)";

export const AXIS = {
  stroke: "rgba(18, 23, 45, 0.15)",
  tick: { fill: "rgba(18, 23, 45, 0.6)", fontSize: 12 },
  grid: "rgba(18, 23, 45, 0.07)",
};

export function seriesColor(index: number): string {
  return index < SERIES_COLORS.length ? SERIES_COLORS[index] : OTHER_COLOR;
}

export type ValueFormat = "number" | "currency";

export function formatValue(value: number, format: ValueFormat, currency = "USD", compact = false): string {
  if (format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
      minimumFractionDigits: compact ? 0 : 2,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", { notation: compact ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
