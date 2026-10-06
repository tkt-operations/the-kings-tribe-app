/**
 * RFC 4180 CSV with protection against spreadsheet formula injection:
 * text cells starting with = + - @ (or tab/CR) are prefixed with an apostrophe.
 * Numbers produced by this app (e.g. "-12.50") are passed as type "number".
 */
export type CsvCell = string | number | null | undefined | { number: string };

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "object") text = value.number;
  else if (typeof value === "number") text = String(value);
  else {
    text = value;
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
