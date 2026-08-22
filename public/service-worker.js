/**
 * Alternate path kept in sync with /sw.js so old registrations update cleanly.
 * Installability + Web Push — does not intercept network traffic.
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
  const tag =
    typeof data.tag === "string" && data.tag.trim()
      ? data.tag.trim()
      : `team-connect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const vibrate = Array.isArray(data.vibrate) ? data.vibrate : [300, 100, 300, 100, 500];

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      vibrate,
      silent: false,
      renotify: true,
      requireInteraction: true,
    }),
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
