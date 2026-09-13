import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Keys that drive auth, route guards, and Branch Mode. Refreshing them
 * can remount the shell or re-run beforeLoad, which redirects to /auth,
 * /dashboard, or /platform. Page data refresh must not touch these.
 */
function isSessionOrGuardQuery(queryKey: QueryKey): boolean {
  const head = queryKey[0];
  return head === "auth" || head === "route-guard";
}

function currentAppPath(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Soft refresh used by pull-to-refresh and the header refresh button.
 *
 * Refetches active page queries in place. Does NOT:
 * - call window.location.reload() (native persistSession:false → /auth)
 * - call router.invalidate() (re-runs layout beforeLoad → /dashboard|/auth)
 *
 * URL / history stay on the page the user is viewing (e.g. /tasks).
 */
export async function refreshPageData(
  qc: QueryClient,
  router?: { history: { replace: (path: string) => void } },
): Promise<void> {
  const stayOn = currentAppPath();

  await qc.invalidateQueries({
    refetchType: "active",
    predicate: (query) => !isSessionOrGuardQuery(query.queryKey),
  });

  const now = currentAppPath();
  if (stayOn && now && now !== stayOn) {
    if (router?.history) router.history.replace(stayOn);
    else if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", stayOn);
    }
  }
}
