"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSafeNotificationLink } from "@/lib/notifications/links";

/** Message the service worker sends when it cannot navigate an open window itself (public/sw.js). */
export const SW_NAVIGATE_MESSAGE = "tkt:navigate";

export function ServiceWorkerRegistration() {
  const router = useRouter();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installation still works without the service worker on iOS.
    });
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
      if (window.location.pathname !== data.url) router.push(data.url);
    };
    container.addEventListener("message", onMessage);
    container.startMessages?.();
    return () => container.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
