/** Register the installability service worker without blocking the UI. */

const PWA_SW_PATH = "/sw.js";

function isOurInstallSw(scriptURL: string): boolean {
  return /\/sw\.js(\?|$)/.test(scriptURL) || /\/service-worker\.js(\?|$)/.test(scriptURL);
}

/** Drop legacy/workbox workers; keep the installability SW. */
async function pruneForeignServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    regs.map(async (reg) => {
      const scriptURL =
        reg.active?.scriptURL ||
        reg.installing?.scriptURL ||
        reg.waiting?.scriptURL ||
        "";
      if (scriptURL && isOurInstallSw(scriptURL)) return;
      try {
        await reg.unregister();
      } catch {
        /* ignore */
      }
    }),
  );
}

export async function registerPwaServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    // Cache-bust so clients pick up push/sound fixes in sw.js.
    const reg = await navigator.serviceWorker.register(`${PWA_SW_PATH}?v=push-sound-4`, {
      scope: "/",
    });
    void reg.update();
    void pruneForeignServiceWorkers();
  } catch (err) {
    console.warn("[pwa] service worker registration failed", err);
  }
}
