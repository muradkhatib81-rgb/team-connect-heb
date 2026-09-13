/**
 * Keeps CSS max-width clamps aligned to the visual viewport (not 100vw,
 * which on iOS/Android can include chrome and widen the page by a few px).
 * Does not set overflow on body — that would steal window.scrollY.
 */
export function installDocumentWidthLock() {
  if (typeof document === "undefined") return () => {};

  const root = document.documentElement;
  const sync = () => {
    const w = window.visualViewport?.width ?? window.innerWidth;
    root.style.setProperty("--app-visual-width", `${Math.round(w)}px`);
  };

  sync();
  window.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("scroll", sync);

  return () => {
    window.removeEventListener("resize", sync);
    window.visualViewport?.removeEventListener("resize", sync);
    window.visualViewport?.removeEventListener("scroll", sync);
  };
}
