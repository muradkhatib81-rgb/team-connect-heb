// Kill-switch service worker.
// Evicts any previously-registered app service worker so returning visitors
// stop being served stale HTML/JS from a cached app shell. Safe no-op for
// users who never had a worker installed.
function isOwnWorkboxCache(name) {
  const isWorkboxBucket =
    /(^|-)precache-v\d+-|(^|-)runtime-|(^|-)googleAnalytics-/.test(name);
  return isWorkboxBucket && name.endsWith(self.registration.scope);
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.allSettled(
          names.filter(isOwnWorkboxCache).map((n) => caches.delete(n)),
        );
        await self.clients.claim();
        const wins = await self.clients.matchAll({ type: "window" });
        await Promise.allSettled(wins.map((c) => c.navigate(c.url)));
      } finally {
        await self.registration.unregister();
      }
    })(),
  ),
);
