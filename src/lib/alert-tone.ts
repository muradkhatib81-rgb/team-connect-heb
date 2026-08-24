/**
 * Strong in-app alert tones for break lifecycle (and generic push when app open).
 * Service worker asks open tabs to play these when a push arrives.
 */

const TONE_URLS = {
  break_start: "/sounds/break-start.wav",
  // Same ringtone as break start (in-app + push payloads).
  break_end: "/sounds/break-start.wav",
  break_late: "/sounds/break-start.wav",
  default: "/sounds/notify.wav",
} as const;

export type AlertToneKind = keyof typeof TONE_URLS;

let lastAudio: HTMLAudioElement | null = null;

export function playAlertTone(kind: AlertToneKind = "default"): void {
  if (typeof window === "undefined") return;
  try {
    lastAudio?.pause();
    const audio = new Audio(TONE_URLS[kind] ?? TONE_URLS.default);
    audio.volume = 1;
    lastAudio = audio;
    void audio.play().catch(() => {
      /* autoplay may be blocked until a user gesture */
    });
  } catch {
    /* ignore */
  }
}

export function resolveAlertTone(raw: unknown): AlertToneKind {
  if (raw === "break_start" || raw === "break_end" || raw === "break_late") return raw;
  return "default";
}

/** Listen for SW → page tone requests while the app is open. */
export function bindPushToneListener(): () => void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }
  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.type !== "PLAY_ALERT_TONE") return;
    playAlertTone(resolveAlertTone(data.tone));
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
