import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Loader2, Coffee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApproveList } from "./breaks";
import { BreakSettingsPage } from "./break-settings";
import { BreakRequestPermissionsCard } from "@/components/break-request-permissions-card";

export const Route = createFileRoute("/_authenticated/breaks-admin")({
  component: BreaksAdminPage,
});

interface BreakRequest {
  id: string;
  user_id: string;
  department_id: string | null;
  break_setting_id: string;
  requested_at: string;
  approved_at_time: string | null;
  duration_minutes: number;
  note: string | null;
  status: string;
  approved_by: string | null;
  approval_decided_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function BreaksAdminPage() {
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const isMainAdmin = !!me?.roles.includes("main_admin");
  const isBranchManager = !!me?.roles.includes("branch_manager");

  const permQ = useQuery({
    enabled: !!me?.id && !isMainAdmin,
    queryKey: ["my-break-manage-perm", me?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_breaks")
        .eq("user_id", me!.id)
        .maybeSingle();
      return !!(data as any)?.can_manage_breaks;
    },
  });

  const isBreaksManager =
    isMainAdmin || isBranchManager || !!permQ.data;

  // Hard redirect: non-managers must go to the employee request screen.
  useEffect(() => {
    if (!me) return;
    if (!isMainAdmin && permQ.isLoading) return;
    if (!isBreaksManager) {
      window.location.replace("/breaks");
    }
  }, [me, isMainAdmin, permQ.isLoading, isBreaksManager]);

  const allReqQ = useQuery({
    enabled: !!me && isBreaksManager,
    queryKey: ["all-break-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as BreakRequest[];
    },
  });

  const settingsQ = useQuery({
    enabled: !!me && isBreaksManager,
    queryKey: ["break-settings-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_settings")
        .select("id, name, duration_minutes, order_index, is_active")
        .eq("is_active", true)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const userIds = useMemo(() => {
    const s = new Set<string>();
    (allReqQ.data ?? []).forEach((r) => s.add(r.user_id));
    return Array.from(s);
  }, [allReqQ.data]);

  const profilesQ = useQuery({
    enabled: isBreaksManager && userIds.length > 0,
    queryKey: ["break-req-profiles", userIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, department_id")
        .in("id", userIds);
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; department_id: string | null }[];
    },
  });

  const deptsQ = useQuery({
    enabled: !!me && isBreaksManager,
    queryKey: ["all-departments-breaks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, manager_id");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; manager_id: string | null }[];
    },
  });

  useEffect(() => {
    if (!isBreaksManager) return;
    const ch = supabase
      .channel("breaks-admin-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_requests" },
        () => {
          qc.invalidateQueries({ queryKey: ["all-break-requests"] });
          qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
          qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
          qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_settings" },
        () => qc.invalidateQueries({ queryKey: ["break-settings-active"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, isBreaksManager]);

  if (!me) return null;
  if (!isBreaksManager) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const pendingCount = (allReqQ.data ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Coffee className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">ניהול הפסקות</h1>
          <p className="text-sm text-muted-foreground mt-1">
            אישור בקשות, ניהול הגדרות הפסקות וצפייה במצב בזמן אמת.
          </p>
        </div>
      </header>

      <Tabs defaultValue="approve" className="space-y-4">
        <TabsList>
          <TabsTrigger value="approve">
            אישור בקשות{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="settings">הגדרות הפסקות</TabsTrigger>
          {(isMainAdmin || isBranchManager) && (
            <TabsTrigger value="permissions">הרשאות בקשת הפסקה</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="approve">
          <ApproveList
            all={allReqQ.data ?? []}
            loading={allReqQ.isLoading}
            settings={(settingsQ.data ?? []) as any}
            profiles={profilesQ.data ?? []}
            departments={deptsQ.data ?? []}
            me={me.id}
          />
        </TabsContent>

        <TabsContent value="settings">
          <Card className="card-elevated p-0 sm:p-2 bg-transparent border-0 shadow-none">
            <BreakSettingsPage />
          </Card>
        </TabsContent>

        {(isMainAdmin || isBranchManager) && (
          <TabsContent value="permissions">
            <BreakRequestPermissionsCard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
