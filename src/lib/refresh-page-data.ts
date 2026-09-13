import type { QueryClient } from "@tanstack/react-query";

/**
 * Soft refresh used by pull-to-refresh and the header refresh button.
 * Invalidates in-place so the Capacitor in-memory session (persistSession:false)
 * and the web localStorage session both survive. A full document reload would
 * remount the client, lose the native session, and bounce to /auth.
 */
export async function refreshPageData(
  qc: QueryClient,
  router: { invalidate: () => Promise<unknown> | unknown },
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ refetchType: "active" }),
    Promise.resolve(router.invalidate()),
  ]);
}
