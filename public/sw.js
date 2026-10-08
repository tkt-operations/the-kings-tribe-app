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

// Sent to an open app window when the worker cannot navigate it itself; the app
// routes to the same allowlisted path (components/pwa/service-worker-registration.tsx).
const NAVIGATE_MESSAGE = "tkt:navigate";

async function focusClient(client) {
  try {
    if (client && typeof client.focus === "function") await client.focus();
  } catch {
    // Focus can be refused; the notification tap already brings the app forward on most platforms.
  }
}

// Tapping a notification must end on its exact in-app path (already allowlisted):
//  - a window already showing that path is just focused;
//  - otherwise an open app window is navigated there and focused, or, where the
//    browser cannot navigate it (iOS PWAs, windows not controlled by this
//    worker), told to route itself there;
//  - with no open window, a new one is opened at that path.
async function openFromNotification(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const ours = windows.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  const exact = ours.find((client) => client.url.split("#")[0] === target);
  if (exact) {
    await focusClient(exact);
    return;
  }
  const client = ours.find((c) => c.focused) || ours.find((c) => c.visibilityState === "visible") || ours[0];
  if (client) {
    let navigated = null;
    if (typeof client.navigate === "function") {
      try {
        navigated = await client.navigate(target);
      } catch {
        navigated = null;
      }
    }
    if (navigated) {
      await focusClient(navigated);
      return;
    }
    try {
      client.postMessage({ type: NAVIGATE_MESSAGE, url: path });
    } catch {
      // Nothing else to try for this window.
    }
    await focusClient(client);
    return;
  }
  if (self.clients.openWindow) await self.clients.openWindow(target);
}

// iOS installed apps do not reliably follow the tap: WindowClient.navigate() may
// not move the window, a message to a suspended page can be lost, and a cold
// launch can open at the start page instead of the requested path. So the tapped
// destination is also remembered (path + time only, nothing sensitive) and the
// app routes to it when it starts, resumes or changes page
// (components/pwa/service-worker-registration.tsx). The cache name starts with
// VERSION so "activate" keeps it.
const PENDING_LINK_CACHE = `${VERSION}-deeplink`;
const PENDING_LINK_KEY = "/__tkt/pending-notification-link";

async function rememberDestination(path) {
  try {
    const cache = await caches.open(PENDING_LINK_CACHE);
    await cache.put(PENDING_LINK_KEY, new Response(JSON.stringify({ url: path, at: Date.now() }), { headers: { "Content-Type": "application/json" } }));
  } catch {
    // Best effort: the direct navigation below still runs.
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(rememberDestination(path).then(() => openFromNotification(path)));
});
