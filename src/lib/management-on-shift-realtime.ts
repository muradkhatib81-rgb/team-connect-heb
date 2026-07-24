import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Realtime listener for management_on_shift.
 *
 * INSERT/UPDATE payloads include branch_id, but DELETE events (with default
 * REPLICA IDENTITY) only carry the primary key — so branch_id filters miss
 * deletes and other clients keep stale cards until a manual refresh.
 */
export function onManagementOnShiftChanges(
  channel: RealtimeChannel,
  branchId: string,
  onChange: () => void,
): RealtimeChannel {
  const table = "management_on_shift" as const;
  const schema = "public" as const;
  return channel
    .on(
      "postgres_changes",
      { event: "INSERT", schema, table, filter: `branch_id=eq.${branchId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema, table, filter: `branch_id=eq.${branchId}` },
      onChange,
    )
    .on("postgres_changes", { event: "DELETE", schema, table }, onChange);
}
