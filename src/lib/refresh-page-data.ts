import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { persistCurrentAppPath } from "@/lib/last-app-path";
import { bumpPageRemount } from "@/lib/page-remount";

/**
 * Keys that drive auth, route guards, Branch Mode, and chrome. Refreshing
 * them remounts the shell or re-runs beforeLoad (→ /auth, /dashboard,
 * /platform). Page refresh must not touch these.
 */
const SESSION_OR_SHELL_HEADS = new Set<unknown>([
  "auth",
  "route-guard",
  "active-branch",
  "platform-companies",
  "platform-branches",
  "shell-can-manage-breaks",
  "shell-comm-unread",
  "attendance-caps",
  "custody-caps",
  "notif",
  "company-settings",
  "my-ai-access",
  "current-user-permissions",
  "my-break-manage-perm",
]);

function isSessionOrGuardQuery(queryKey: QueryKey): boolean {
  return SESSION_OR_SHELL_HEADS.has(queryKey[0]);
}

function currentAppPath(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function scrollPageToTop(): void {
  if (typeof window === "undefined") return;
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const viewport = document.querySelector(".app-viewport");
  if (viewport instanceof HTMLElement) viewport.scrollTop = 0;
}

/**
 * In-app refresh used by pull-to-refresh and the header refresh button.
 *
 * Feels like F5 for the current page: drop page query cache and remount
 * the page outlet so local UI state resets and data loads again.
 *
 * Does NOT:
 * - call window.location.reload() (native persistSession:false → /auth flash)
 * - call router.invalidate() (re-runs layout beforeLoad → /dashboard|/auth)
 */
export async function refreshPageData(
  qc: QueryClient,
  router?: { history: { replace: (path: string) => void } },
): Promise<void> {
  const stayOn = currentAppPath();
  persistCurrentAppPath(stayOn);

  await qc.cancelQueries({
    predicate: (query) => !isSessionOrGuardQuery(query.queryKey),
  });
  qc.removeQueries({
    predicate: (query) => !isSessionOrGuardQuery(query.queryKey),
  });

  bumpPageRemount();
  scrollPageToTop();

  const now = currentAppPath();
  if (stayOn && now && now !== stayOn) {
    if (router?.history) router.history.replace(stayOn);
    else if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", stayOn);
    }
  }
}
