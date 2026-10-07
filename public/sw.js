/*
 * The Kings Tribe — minimal service worker.
 * Caches ONLY static, non-sensitive assets (brand files, icons, fonts, Next
 * static chunks) and an offline fallback page. Financial pages and API data
 * are never cached: navigations always go to the network.
 *
 * Web Push: shows a short, generic alert (plain text) and opens an allowlisted
 * in-app path when tapped. Push payloads are never cached. Opening the app
 * still goes through normal sign-in and permission checks.
 */
const VERSION = "tkt-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll([OFFLINE_URL, "/brand/logomark-gold.svg", "/brand/logo-primary-gold-on-navy.svg", "/icons/icon-192.png"]),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/brand/") ||
      url.pathname.startsWith("/icons/"))
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------
const PUSH_TITLE = "The Kings Tribe";
const PUSH_FALLBACK = "You have a new notification";
// Same allowlist as the server (lib/notifications/links.ts): fixed in-app paths only.
const SAFE_PATH = /^\/(requisitions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|receipts|dashboard|notifications)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function safePath(value) {
  return typeof value === "string" && SAFE_PATH.test(value) ? value : "/notifications";
}

function setBadge(count) {
  try {
    const nav = self.navigator;
    if (!nav || typeof nav.setAppBadge !== "function" || typeof nav.clearAppBadge !== "function") return Promise.resolve();
    return (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const body = typeof data.body === "string" && data.body.trim() ? data.body.trim().slice(0, 120) : PUSH_FALLBACK;
  const options = {
    body,
    icon: "/icons/icon-192.png",
    data: { url: safePath(data.url) },
  };
  if (typeof data.tag === "string" && UUID.test(data.tag)) options.tag = data.tag;
  const badge = Number.isInteger(data.badge) && data.badge >= 0 ? data.badge : null;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(PUSH_TITLE, options),
      badge === null ? Promise.resolve() : setBadge(badge),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        const focused = typeof client.focus === "function" ? await client.focus() : client;
        if (focused && typeof focused.navigate === "function") {
          try {
            await focused.navigate(target);
          } catch {
            // Navigation can be refused for uncontrolled clients; the app is focused anyway.
          }
        }
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    }),
  );
});
