"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isSafeNotificationLink } from "@/lib/notifications/links";

/** Message the service worker sends when it cannot navigate an open window itself (public/sw.js). */
export const SW_NAVIGATE_MESSAGE = "tkt:navigate";

/** Where the service worker remembers a tapped notification's destination (public/sw.js PENDING_LINK_CACHE). */
export const PENDING_LINK_CACHE = "tkt-deeplink";
/** Re-check for that destination for a few seconds after the app appears: iOS can show the app before the worker stores it. */
export const PENDING_LINK_RECHECK_MS = [0, 400, 1200, 2500, 4000] as const;
/** At most one service-worker update check per this interval (on start and when the app comes back to the foreground). */
export const SW_UPDATE_INTERVAL_MS = 60_000;
export const PENDING_LINK_KEY = "/__tkt/pending-notification-link";
/** A remembered destination older than this is ignored (the tap was not followed in time). */
export const PENDING_LINK_MAX_AGE_MS = 10 * 60 * 1000;
/** Pages that never consume it: sign-in and public pages keep it for after sign-in. */
const KEEP_ON = /^\/(login|forgot-password|auth|setup|request|notifications\/[^/]+|offline)(\/|$)/;

/**
 * The remembered destination of the last tapped notification, if it is fresh
 * and allowlisted. Consumed (deleted) once read on an app page. Never throws.
 */
export async function takePendingNotificationLink(pathname: string, now = Date.now()): Promise<string | null> {
  if (typeof caches === "undefined" || KEEP_ON.test(pathname)) return null;
  try {
    const cache = await caches.open(PENDING_LINK_CACHE);
    const response = await cache.match(PENDING_LINK_KEY);
    if (!response) return null;
    await cache.delete(PENDING_LINK_KEY);
    const data = (await response.json().catch(() => null)) as { url?: unknown; at?: unknown } | null;
    if (!data || typeof data.at !== "number" || now - data.at > PENDING_LINK_MAX_AGE_MS || data.at - now > 60_000) return null;
    if (!isSafeNotificationLink(data.url) || data.url === pathname) return null;
    return data.url;
  } catch {
    return null;
  }
}

async function clearPendingNotificationLink() {
  try {
    if (typeof caches !== "undefined") await (await caches.open(PENDING_LINK_CACHE)).delete(PENDING_LINK_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function ServiceWorkerRegistration() {
  const router = useRouter();
  const pathname = usePathname();

  // Register, then check for a newer worker on start and whenever the app comes
  // back to the foreground (throttled). An installed iPhone app is usually
  // resumed rather than reloaded, and re-registering does not check for
  // updates, so without this it can keep running an old worker. The new worker
  // takes over by itself (skipWaiting + clients.claim); the page never reloads.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let lastCheck = 0;
    const checkForUpdate = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastCheck < SW_UPDATE_INTERVAL_MS) return;
      lastCheck = Date.now();
      void navigator.serviceWorker.getRegistration("/").then((r) => r?.update()).catch(() => {
        // Offline or blocked: try again next time.
      });
    };
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(checkForUpdate, () => {
      // Installation still works without the service worker on iOS.
    });
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => document.removeEventListener("visibilitychange", checkForUpdate);
  }, []);

  // A tapped push notification whose window the worker could not navigate (e.g. an
  // installed iPhone app already open on another page): go to its exact in-app path.
  // Only allowlisted same-origin paths are accepted; normal sign-in and page
  // permission checks still apply after navigating.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      if (event.origin && event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || data.type !== SW_NAVIGATE_MESSAGE || !isSafeNotificationLink(data.url)) return;
      void clearPendingNotificationLink();
      if (window.location.pathname !== data.url) router.push(data.url);
    };
    container.addEventListener("message", onMessage);
    container.startMessages?.();
    return () => container.removeEventListener("message", onMessage);
  }, [router]);

  // Fallback for iOS: follow a tapped notification's remembered destination when
  // the app starts, comes back to the foreground or changes page (e.g. after
  // signing in). Only fresh, allowlisted same-origin paths; read once.
  useEffect(() => {
    let cancelled = false;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const checkOnce = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void takePendingNotificationLink(window.location.pathname).then((url) => {
        if (url && !cancelled) {
          cancelled = true; // follow it once
          router.push(url);
        }
      });
    };
    // Check now and again over the next few seconds (the tap may be stored just after the app appears).
    const check = () => {
      timers.forEach(clearTimeout);
      timers = PENDING_LINK_RECHECK_MS.map((ms) => setTimeout(checkOnce, ms));
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    const container = "serviceWorker" in navigator ? navigator.serviceWorker : null;
    container?.addEventListener("controllerchange", check);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("focus", check);
      container?.removeEventListener("controllerchange", check);
    };
  }, [router, pathname]);

  return null;
}
