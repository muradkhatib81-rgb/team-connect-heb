import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPlatformOwner, type AppRole } from "@/lib/constants";
import type { OnlinePresenceViewerAccess } from "@/lib/online-presence";

function mapAccess(row: {
  can_view: boolean;
  viewer_scope: string | null;
  branch_id: string | null;
  company_id: string | null;
} | null): OnlinePresenceViewerAccess {
  if (!row?.can_view || !row.viewer_scope) {
    return { canView: false, viewerScope: null, branchId: null, companyId: null };
  }
  const scope = row.viewer_scope as OnlinePresenceViewerAccess["viewerScope"];
  return {
    canView: true,
    viewerScope: scope,
    branchId: row.branch_id,
    companyId: row.company_id,
  };
}

export function useOnlinePresenceViewerAccess(userId?: string, roles?: AppRole[]) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["online-presence-viewer-access", userId],
    queryFn: async (): Promise<OnlinePresenceViewerAccess> => {
      if (roles && isPlatformOwner(roles)) {
        return {
          canView: true,
          viewerScope: "platform",
          branchId: null,
          companyId: null,
        };
      }
      const { data, error } = await supabase.rpc("resolve_online_presence_viewer_access" as never, {
        _user_id: userId!,
      });
      if (error) {
        // Migration not applied yet — fail soft so the app keeps working.
        if (/resolve_online_presence_viewer_access|does not exist|PGRST202/i.test(error.message)) {
          return { canView: false, viewerScope: null, branchId: null, companyId: null };
        }
        throw error;
      }
      const row = (data as Array<{
        can_view: boolean;
        viewer_scope: string | null;
        branch_id: string | null;
        company_id: string | null;
      }> | null)?.[0];
      return mapAccess(row ?? null);
    },
    staleTime: 30_000,
  });
}
