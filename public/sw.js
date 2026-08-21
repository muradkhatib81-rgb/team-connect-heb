/**
 * Installability service worker (PWA).
 * Network-only: never caches HTML/JS/API — avoids stale shells after deploy.
 * Does not change auth, roles, RLS, or app business logic.
 */
const SW_VERSION = "pwa-install-v1";

self.addEventListener("install", (event) => {
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

self.addEventListener("fetch", (event) => {
  // Always go to the network. Offline shell is intentionally not supported yet.
  event.respondWith(fetch(event.request));
});
