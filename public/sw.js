/**
 * Installability service worker (PWA).
 * Does NOT intercept network traffic — calling respondWith(fetch()) on every
 * request adds latency with no caching benefit. An empty fetch listener keeps
 * installability without slowing navigations or API calls.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.allSettled(names.map((name) => caches.delete(name)));
      } finally {
        await self.clients.claim();
      }
    })(),
  );
});

// Presence of a fetch listener satisfies installability checks.
// Do not call event.respondWith — let the browser handle requests directly.
self.addEventListener("fetch", () => {});
