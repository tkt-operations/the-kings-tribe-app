/** Receipt file rules shared by browser and server. Storage enforces them again. */
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MAX_FILES = 5;

const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};

export const RECEIPT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Validate a file by BOTH extension and declared MIME type. Returns the
 * canonical MIME type, or an error message. (Some browsers report HEIC with
 * an empty type; the extension decides then.)
 */
export function checkReceiptFile(file: { name: string; type: string; size: number }): { ok: true; mime: string; ext: string } | { ok: false; error: string } {
  const ext = extensionOf(file.name);
  const expected = BY_EXTENSION[ext];
  if (!expected) return { ok: false, error: `${file.name}: only PDF, JPEG, PNG or HEIC files are accepted` };
  const declared = (file.type || "").toLowerCase();
  const compatible = declared === "" || declared === expected || (expected.startsWith("image/hei") && declared.startsWith("image/hei"));
  if (!compatible) return { ok: false, error: `${file.name}: the file type does not match its extension` };
  if (file.size <= 0) return { ok: false, error: `${file.name}: the file is empty` };
  if (file.size > RECEIPT_MAX_BYTES) return { ok: false, error: `${file.name}: files must be 10 MB or smaller` };
  return { ok: true, mime: expected, ext: ext === "jpeg" ? "jpg" : ext };
}
