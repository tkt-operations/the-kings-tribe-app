import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** 256-bit random, URL-safe token for external requisition links. */
export function generateFormToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
