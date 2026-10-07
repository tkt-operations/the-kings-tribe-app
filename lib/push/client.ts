/**
 * Browser-side Web Push helpers (client-safe; no secrets). Permission is only
 * ever requested from an explicit button press in the settings panel.
 */

export type PushSupport = "supported" | "ios_needs_install" | "unsupported";

export function isIos(nav: Navigator = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

export function isStandalone(win: Window = window): boolean {
  return Boolean(win.matchMedia?.("(display-mode: standalone)").matches || (win.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function pushSupport(win: Window = window): PushSupport {
  const nav = win.navigator;
  if ("serviceWorker" in nav && "PushManager" in win && "Notification" in win) return "supported";
  // iOS/iPadOS only offers Web Push to apps added to the Home Screen.
  if (isIos(nav) && !isStandalone(win)) return "ios_needs_install";
  return "unsupported";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Does an existing subscription use this application-server key? (False after a key change.) */
export function sameServerKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = urlBase64ToUint8Array(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Coarse, non-identifying label for the device list ("iPhone · Safari"). */
export function deviceLabel(ua: string): string {
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) || /CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${device} · ${browser}`;
}
