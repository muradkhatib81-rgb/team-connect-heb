import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { persistCurrentAppPath } from "@/lib/last-app-path";
import { bumpPageRemount } from "@/lib/page-remount";

/**
 * Keys that drive auth, route guards, Branch Mode, and chrome. Refreshing
 * them remounts the shell or re-runs beforeLoad (→ /auth, /dashboard,
 * /platform). Page refresh must not touch these.
 *
 * `my-ai-access` stays here so Ask AI does not flicker for a Platform Owner
 * without a branch (PR #10).
 */
const SESSION_OR_SHELL_HEADS = new Set<unknown>([
  "auth",
  "route-guard",
  "active-branch",
  "shell-can-manage-breaks",
  "shell-comm-unread",
  "attendance-caps",
  "custody-caps",
  "notif",
  "company-settings",
  "my-ai-access",
  "current-user-permissions",
  "my-break-manage-perm",
  "customer-billing-gate",
  "platform-feature-flag-state",
]);

/**
 * Company/branch lists live on shell providers (outside the remount
 * boundary) and are the data source for many /platform pages. Emptying
 * them makes `activeCompany`/`activeBranch` resolve to null and can
 * flicker Branch Mode. Refetch in place instead.
 */
const SHELL_LIST_HEADS = new Set<unknown>(["platform-companies", "platform-branches"]);

export type RefreshKeyPolicy = "keep" | "soft-refetch" | "drop";

/** How in-app refresh treats a query. Exported so the policy can be tested. */
export function refreshKeyPolicy(queryKey: QueryKey): RefreshKeyPolicy {
  const head = queryKey[0];
  if (SESSION_OR_SHELL_HEADS.has(head)) return "keep";
  if (SHELL_LIST_HEADS.has(head)) return "soft-refetch";
  return "drop";
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
    predicate: (query) => refreshKeyPolicy(query.queryKey) !== "keep",
  });
  qc.removeQueries({
    predicate: (query) => refreshKeyPolicy(query.queryKey) === "drop",
  });
  // In-place refetch so Companies / Branches / other context-backed
  // platform pages update without dropping the active selection.
  await qc.invalidateQueries({
    predicate: (query) => refreshKeyPolicy(query.queryKey) === "soft-refetch",
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
