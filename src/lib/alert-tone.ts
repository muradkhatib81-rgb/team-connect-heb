/** Short audible alert when OS push is suppressed (app in foreground). */

let lastBeepAt = 0;

export function playAlertTone(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  // Coalesce bursts (one schedule publish → one tone).
  if (now - lastBeepAt < 1_200) return;
  lastBeepAt = now;

  try {
    navigator.vibrate?.([220, 80, 220, 80, 320]);
  } catch {
    /* ignore */
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    osc.start(t0);
    osc.stop(t0 + 0.3);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    /* autoplay / unsupported — vibrate-only is fine */
  }
}

/** Listen for service-worker push alerts while a tab is open. */
export function installPushAlertToneListener(): () => void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data?.type === "PLAY_ALERT") playAlertTone();
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
