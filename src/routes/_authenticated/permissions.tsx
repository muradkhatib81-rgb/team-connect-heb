import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  DEPARTMENT_LABELS,
  canManageUsers,
  type AppRole,
  type Department,
} from "@/lib/constants";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/permissions")({
  component: PermissionsPage,
});

interface Row {
  id: string;
  full_name: string;
  department: Department;
  role: AppRole;
}

function PermissionsPage() {
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const allowed = me ? canManageUsers(me.roles) : false;

  const query = useQuery({
    enabled: allowed,
    queryKey: ["permissions-list"],
    queryFn: async () => {
      const [{ data: profiles, error: pe }, { data: roles, error: re }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, department").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pe) throw pe;
      if (re) throw re;
      const roleMap: Record<string, AppRole> = {};
      (roles ?? []).forEach((r) => (roleMap[r.user_id] = r.role as AppRole));
      return (profiles ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        department: p.department as Department,
        role: roleMap[p.id] ?? "employee",
      })) as Row[];
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error: dErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (dErr) throw dErr;
      const { error: iErr } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (iErr) throw iErr;
    },
    onSuccess: () => {
      toast.success("ההרשאה עודכנה");
      qc.invalidateQueries({ queryKey: ["permissions-list"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  if (!allowed) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">רק מנהל ראשי יכול לנהל הרשאות.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <ShieldCheck className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">ניהול הרשאות</h1>
          <p className="text-sm text-muted-foreground mt-1">קביעת תפקיד מערכת לכל עובד</p>
        </div>
      </header>

      {query.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-3">
          {query.data?.map((row) => (
            <Card key={row.id} className="card-elevated p-4 flex items-center gap-4">
              <div className="size-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-semibold shrink-0">
                {row.full_name?.charAt(0) || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{row.full_name || "ללא שם"}</p>
                <p className="text-xs text-muted-foreground">{DEPARTMENT_LABELS[row.department]}</p>
              </div>
              <div className="w-40 shrink-0">
                <Select
                  value={row.role}
                  disabled={row.id === me?.id || mutation.isPending}
                  onValueChange={(v) => mutation.mutate({ userId: row.id, role: v as AppRole })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {row.id === me?.id && (
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">אינך יכול לערוך את עצמך</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
