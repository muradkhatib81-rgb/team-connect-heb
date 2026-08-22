/**
 * Installability + Web Push service worker (PWA).
 * Does NOT intercept network traffic — calling respondWith(fetch()) on every
 * request adds latency with no caching benefit.
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

self.addEventListener("fetch", () => {});

function parsePushPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    const text = event.data.text();
    return text ? { title: "מערכת ניהול עובדים", body: text, url: "/dashboard" } : null;
  }
}

self.addEventListener("push", (event) => {
  const data = parsePushPayload(event) ?? {
    title: "מערכת ניהול עובדים",
    body: "יש עדכון חדש",
    url: "/dashboard",
  };

  const title = data.title || "מערכת ניהול עובדים";
  const body = data.body || "";
  const url = data.url || "/dashboard";
  // Always unique — reused tags can replace quietly on some OS/browsers.
  const tag = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const vibrate = [400, 120, 400, 120, 600];

  event.waitUntil(
    (async () => {
      try {
        const existing = await self.registration.getNotifications();
        await Promise.allSettled(existing.map((n) => n.close()));
      } catch {
        /* ignore */
      }

      await self.registration.showNotification(title, {
        body,
        tag,
        data: { url },
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate,
        // Explicit non-silent so Android/Chrome use the alert channel (not "silent").
        silent: false,
        renotify: true,
        requireInteraction: true,
        timestamp: Date.now(),
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/dashboard";
  const targetUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windowClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
