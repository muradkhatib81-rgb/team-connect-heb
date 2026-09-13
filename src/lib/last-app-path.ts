/**
 * Remember the last in-app path so a hard reload that rematches `/`
 * (or `/auth` / role home) can return the user to the page they were on.
 *
 * sessionStorage only — same lifetime as a document session. Not used for
 * fresh login (auth still lands on role home) or native back-to-home.
 */

const LAST_PATH_KEY = "tc:last-app-path";
const RESTORED_KEY = "tc:last-app-path-restored";

const LOST_LANDING_PATHS = new Set(["/", "/dashboard", "/platform", "/auth"]);

const BLOCKED_PATHS = new Set(["/", "/auth"]);

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

export function isDocumentReload(): boolean {
  if (typeof performance === "undefined") return false;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav?.type === "reload") return true;
  } catch {
    /* ignore */
  }
  try {
    return (performance as unknown as { navigation?: { type?: number } }).navigation?.type === 1;
  } catch {
    return false;
  }
}

/** Same-origin app path only. Blocks auth, APIs, and protocol-relative junk. */
function toPathInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("\\")) return null;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed) && !trimmed.startsWith("/")) {
    try {
      const abs = new URL(trimmed);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
      return `${abs.pathname}${abs.search}${abs.hash}`;
    } catch {
      return null;
    }
  }
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

export function sanitizeAppPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = toPathInput(raw);
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed, "https://app.local");
  } catch {
    return null;
  }
  const pathname = normalizePathname(url.pathname);
  if (pathname.startsWith("/api")) return null;
  if (BLOCKED_PATHS.has(pathname)) return null;
  if (pathname.split("/").includes("..")) return null;
  return `${pathname}${url.search}${url.hash}`;
}

export function persistCurrentAppPath(path = currentWindowPath()): void {
  if (typeof sessionStorage === "undefined") return;
  const safe = sanitizeAppPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(LAST_PATH_KEY, safe);
  } catch {
    /* quota / private mode */
  }
}

export function readLastAppPath(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sanitizeAppPath(sessionStorage.getItem(LAST_PATH_KEY));
  } catch {
    return null;
  }
}

function currentWindowPath(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function pathNameOnly(path: string): string {
  try {
    return normalizePathname(new URL(path, "https://app.local").pathname);
  } catch {
    return normalizePathname(path.split(/[?#]/)[0] ?? path);
  }
}

/**
 * If this document load is a reload that lost the deep URL (landed on `/`,
 * `/auth`, or role home), return the stored path once. Fresh navigations
 * and a later click to Dashboard must not bounce back.
 */
export function consumeRestoredAppPath(currentPath: string): string | null {
  if (typeof window === "undefined") return null;
  if (!isDocumentReload()) return null;
  try {
    if (sessionStorage.getItem(RESTORED_KEY) === "1") return null;
  } catch {
    return null;
  }

  const last = readLastAppPath();
  const currentName = pathNameOnly(currentPath || currentWindowPath());
  if (!last) {
    markPathRestored();
    return null;
  }
  if (pathNameOnly(last) === currentName) {
    markPathRestored();
    return null;
  }
  if (!LOST_LANDING_PATHS.has(currentName)) {
    markPathRestored();
    return null;
  }

  markPathRestored();
  return last;
}

function markPathRestored(): void {
  try {
    sessionStorage.setItem(RESTORED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function installLastAppPathTracking(
  subscribe: (onResolved: () => void) => () => void,
): () => void {
  persistCurrentAppPath();
  const unsub = subscribe(() => persistCurrentAppPath());
  const onPageHide = () => {
    persistCurrentAppPath();
    try {
      sessionStorage.removeItem(RESTORED_KEY);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("pagehide", onPageHide);
  return () => {
    unsub();
    window.removeEventListener("pagehide", onPageHide);
  };
}
