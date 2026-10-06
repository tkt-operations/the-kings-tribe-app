/**
 * One-shot success messages for server actions that finish with redirect().
 * The cookie carries only a key from this fixed list, never free text.
 */
export const FLASH_COOKIE = "tkt_flash";

export const FLASH_MESSAGES = {
  "admin-created": "Administrator account created successfully.",
  "signed-in": "Signed in successfully.",
  "password-updated": "Password updated successfully.",
} as const;

export type FlashKey = keyof typeof FLASH_MESSAGES;

export function flashMessage(key: string): string | null {
  return Object.hasOwn(FLASH_MESSAGES, key) ? FLASH_MESSAGES[key as FlashKey] : null;
}
