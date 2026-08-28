import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Users, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { getRoleLabel, type AppRole } from "@/lib/constants";
import type { OnlinePresenceViewerScope } from "@/lib/online-presence";

type ManagerRow = {
  id: string;
  full_name: string;
  role: AppRole;
};

const GRANTS_KEY = ["online-presence-viewer-grants"] as const;

async function fetchBranchCompanyId(branchId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("branches")
    .select("company_id")
    .eq("id", branchId)
    .maybeSingle();
  if (error) throw error;
  return data?.company_id ?? null;
}

async function fetchProfileBranch(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("branch_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.branch_id ?? null;
}

export function OnlinePresenceGrantsCard({ managers }: { managers: ManagerRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useAuth();

  const grantsQ = useQuery({
    queryKey: GRANTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_presence_viewer_grants" as any)
        .select("user_id, enabled, viewer_scope, branch_id, company_id");
      if (error) {
        if (/online_presence_viewer_grants|does not exist|PGRST205/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []) as Array<{
        user_id: string;
        enabled: boolean;
        viewer_scope: OnlinePresenceViewerScope;
        branch_id: string | null;
        company_id: string | null;
      }>;
    },
  });

  const grantByUser = new Map((grantsQ.data ?? []).map((g) => [g.user_id, g]));

  const saveMut = useMutation({
    mutationFn: async ({ userId, enabled, role }: { userId: string; enabled: boolean; role: AppRole }) => {
      if (!enabled) {
        const { error } = await supabase
          .from("online_presence_viewer_grants" as any)
          .upsert(
            {
              user_id: userId,
              viewer_scope: "branch",
              branch_id: null,
              company_id: null,
              enabled: false,
              granted_by: me?.id ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (error) throw error;
        return;
      }

      const branchId = await fetchProfileBranch(userId);
      if (!branchId) {
        throw new Error(t("onlinePresence.grants.noBranch"));
      }
      const companyId = await fetchBranchCompanyId(branchId);

      let viewerScope: OnlinePresenceViewerScope = "branch";

      const { error } = await supabase.from("online_presence_viewer_grants" as any).upsert(
        {
          user_id: userId,
          viewer_scope: viewerScope,
          branch_id: viewerScope === "branch" ? branchId : null,
          company_id: viewerScope === "company" ? companyId : null,
          enabled: true,
          granted_by: me?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GRANTS_KEY });
      qc.invalidateQueries({ queryKey: ["online-presence-viewer-access"] });
      toast.success(t("onlinePresence.grants.saved"));
    },
    onError: (e: Error) => toast.error(e.message ?? t("common.error")),
    retry: false,
  });

  if (managers.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3 mt-8">
        <div className="size-10 rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 flex items-center justify-center">
          <Users className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{t("onlinePresence.grants.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("onlinePresence.grants.subtitle")}</p>
        </div>
      </div>

      <Card className="card-elevated divide-y divide-border overflow-hidden">
        {grantsQ.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          managers.map((m) => {
            const grant = grantByUser.get(m.id);
            const checked = !!grant?.enabled;
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 p-4 bg-card"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{m.full_name}</p>
                  <p className="text-xs text-muted-foreground">{getRoleLabel(m.role)}</p>
                </div>
                <Switch
                  checked={checked}
                  disabled={saveMut.isPending}
                  onCheckedChange={(enabled) =>
                    saveMut.mutate({ userId: m.id, enabled, role: m.role })
                  }
                  aria-label={t("onlinePresence.grants.toggleFor", { name: m.full_name })}
                />
              </div>
            );
          })
        )}
      </Card>
    </section>
  );
}
