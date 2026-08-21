/** Register the network-only installability service worker (no offline cache). */

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
    await pruneForeignServiceWorkers();
    await navigator.serviceWorker.register(PWA_SW_PATH, { scope: "/" });
  } catch (err) {
    console.warn("[pwa] service worker registration failed", err);
  }
}
