// Kill-switch service worker (alternate path).
// Mirrors /sw.js so any previously-registered worker on either path is
// unregistered when the browser next checks for an update.
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
