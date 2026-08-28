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

const PUSH_FALLBACK_BY_LANG = {
  he: { title: "מערכת ניהול עובדים", body: "יש עדכון חדש" },
  ar: { title: "نظام إدارة الموظفين", body: "يوجد تحديث جديد" },
  en: { title: "Employee Management System", body: "New update" },
};

function readAppLanguage() {
  try {
    const stored = localStorage.getItem("app_language");
    if (stored === "he" || stored === "ar" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return "he";
}

function pushFallback() {
  return PUSH_FALLBACK_BY_LANG[readAppLanguage()] ?? PUSH_FALLBACK_BY_LANG.he;
}

function parsePushPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    const text = event.data.text();
    const fb = pushFallback();
    return text ? { title: fb.title, body: text, url: "/dashboard" } : null;
  }
}

function vibrateForTone(tone) {
  if (tone === "break_start") return [500, 100, 500, 100, 700, 120, 900];
  if (tone === "break_end") return [700, 80, 700, 80, 700, 80, 1000];
  if (tone === "break_late") return [300, 60, 300, 60, 300, 60, 300, 60, 800];
  return [400, 120, 400, 120, 600];
}

function soundForTone(tone) {
  // End + late use the same ringtone as start (push + SW).
  if (tone === "break_start" || tone === "break_end" || tone === "break_late") {
    return "/sounds/break-start.wav";
  }
  return undefined;
}

async function askOpenClientsToPlayTone(tone) {
  if (!tone) return;
  try {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of clients) {
      client.postMessage({ type: "PLAY_ALERT_TONE", tone });
    }
  } catch {
    /* ignore */
  }
}

self.addEventListener("push", (event) => {
  const fb = pushFallback();
  const data = parsePushPayload(event) ?? {
    title: fb.title,
    body: fb.body,
    url: "/dashboard",
  };

  const title = data.title || fb.title;
  const body = data.body || "";
  const url = data.url || "/dashboard";
  const tag =
    (typeof data.tag === "string" && data.tag.trim()) ||
    `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tone = data.tone || null;
  const vibrate = Array.isArray(data.vibrate) ? data.vibrate : vibrateForTone(tone);
  const sound = data.sound || soundForTone(tone);

  event.waitUntil(
    (async () => {
      // Do not close previous notifications — Chrome/Windows then silences the next ones.

      await askOpenClientsToPlayTone(tone);

      const options = {
        body,
        tag,
        data: { url, tone },
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate,
        silent: false,
        renotify: true,
        requireInteraction: true,
        timestamp: Date.now(),
      };
      if (sound) options.sound = sound;

      await self.registration.showNotification(title, options);
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
