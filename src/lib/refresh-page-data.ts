import type { QueryClient } from "@tanstack/react-query";

/** Same refresh used by pull-to-refresh and the header refresh button. */
export async function refreshPageData(
  qc: QueryClient,
  router: { invalidate: () => Promise<unknown> | unknown },
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ refetchType: "active" }),
    Promise.resolve(router.invalidate()),
  ]);
}
