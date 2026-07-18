import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listPlatformOwners,
  listPlatformOwnerAuditLog,
  getPlatformOwnerStatus,
  type PlatformOwnerRow,
} from "@/lib/platform-owners.functions";

/** Shared query key for the caller's Platform Owner status. */
export const PLATFORM_OWNER_STATUS_KEY = ["platform", "owner-status"] as const;

/**
 * Authoritative Platform Owner check for the current user, resolved
 * server-side against the same source used by assertCallerIsPlatformOwner.
 * Every /platform/* gate (nav + route) reads from this hook.
 */
export function usePlatformOwnerStatus() {
  const fn = useServerFn(getPlatformOwnerStatus);
  return useQuery<{ isOwner: boolean; isPrimary: boolean }>({
    queryKey: [...PLATFORM_OWNER_STATUS_KEY],
    queryFn: () => fn() as Promise<{ isOwner: boolean; isPrimary: boolean }>,
    staleTime: 60_000,
  });
}

/** Shared query key for the Platform Owners list. */
export const PLATFORM_OWNERS_KEY = ["platform", "owners"] as const;
/** Shared query key for the Platform Owner audit log. */
export const PLATFORM_AUDIT_KEY = ["platform", "audit-log"] as const;

export function usePlatformOwnersQuery() {
  const fn = useServerFn(listPlatformOwners);
  return useQuery<PlatformOwnerRow[]>({
    queryKey: [...PLATFORM_OWNERS_KEY],
    queryFn: () => fn() as Promise<PlatformOwnerRow[]>,
  });
}

export type PlatformAuditRow = {
  id: string;
  actor_id: string | null;
  target_user_id: string | null;
  event: string;
  payload: unknown;
  created_at: string;
};

export function usePlatformAuditQuery() {
  const fn = useServerFn(listPlatformOwnerAuditLog);
  return useQuery<PlatformAuditRow[]>({
    queryKey: [...PLATFORM_AUDIT_KEY],
    queryFn: () => fn() as Promise<PlatformAuditRow[]>,
  });
}

/** Human-readable Hebrew label for every audit event we emit. */
export const PLATFORM_EVENT_LABELS: Record<string, string> = {
  "owner.created": "בעל מערכת נוצר",
  "owner.suspended": "בעל מערכת הושעה",
  "owner.restored": "בעל מערכת שוחזר",
  "owner.deleted": "בעל מערכת נמחק",
  "owner.primary_transferred": "הועברה בעלות ראשית",
  "owner.profile_updated": "פרטי בעל מערכת עודכנו",
};

export function usePlatformStats() {
  const owners = usePlatformOwnersQuery();
  const audit = usePlatformAuditQuery();

  return useMemo(() => {
    const list = owners.data ?? [];
    const activeCount = list.filter((o) => o.is_active).length;
    const suspendedCount = list.filter((o) => !o.is_active).length;
    const primary = list.find((o) => o.level === "primary") ?? null;

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const events30d = (audit.data ?? []).filter(
      (e) => new Date(e.created_at).getTime() >= cutoff,
    ).length;

    return {
      isLoading: owners.isLoading || audit.isLoading,
      activeCount,
      suspendedCount,
      primary,
      primaryCount: primary ? 1 : 0,
      events30d,
    };
  }, [owners.data, owners.isLoading, audit.data, audit.isLoading]);
}
