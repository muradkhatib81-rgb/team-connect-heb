/**
 * Alternate path kept in sync with /sw.js so old registrations update cleanly.
 * Installability only — does not intercept network traffic.
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
