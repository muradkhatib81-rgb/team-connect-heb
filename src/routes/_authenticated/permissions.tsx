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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { setUserPermissions } from "@/lib/tasks.functions";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/permissions")({
  component: PermissionsPage,
});

interface Row {
  id: string;
  full_name: string;
  department_name: string;
  role: AppRole;
}

const GRANULAR_PERMS = [
  { key: "can_create_tasks", label: "יצירת משימות" },
  { key: "can_edit_tasks", label: "עריכת משימות" },
  { key: "can_delete_tasks", label: "מחיקת משימות" },
  { key: "can_approve_tasks", label: "אישור משימות (כשהיוצר הוא אחראי מחלקה)" },
  { key: "can_create_schedule", label: "יצירת סידור עבודה" },
  { key: "can_approve_schedule", label: "אישור סידור עבודה" },
  { key: "can_publish_schedule", label: "אישור ופרסום ישיר של סידורי עבודה" },

  { key: "can_approve_leave", label: "אישור בקשות חופשה" },
  { key: "can_view_breaks", label: "צפייה בעובדים בהפסקה" },
  { key: "can_manage_breaks", label: "ניהול הפסקות (יצירה/עריכה/מחיקה)" },
  { key: "can_send_messages", label: "שליחת הודעות" },
] as const;

type PermKey = (typeof GRANULAR_PERMS)[number]["key"];

function PermissionsPage() {
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const isMainAdmin = !!me?.roles.includes("main_admin");
  const allowed = me ? canManageUsers(me.roles) : false;

  const query = useQuery({
    enabled: allowed,
    queryKey: ["permissions-list"],
    queryFn: async () => {
      const [{ data: profiles, error: pe }, { data: roles, error: re }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, department_id, departments(name)")
          .order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pe) throw pe;
      if (re) throw re;
      const roleMap: Record<string, AppRole> = {};
      (roles ?? []).forEach((r) => (roleMap[r.user_id] = r.role as AppRole));
      return (profiles ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        department_name: p.departments?.name ?? "—",
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

  const managers = (query.data ?? []).filter(
    (r) => r.role === "branch_manager" || r.role === "assistant_manager",
  );

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
                <p className="text-xs text-muted-foreground">{row.department_name}</p>
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

      {isMainAdmin && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 mt-8">
            <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Settings2 className="size-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">הרשאות מפורטות למנהלים</h2>
              <p className="text-sm text-muted-foreground mt-1">
                הענקה/הסרה של הרשאות פעולה למנהל סניף וסגן מנהל. השינוי נכנס לתוקף מיד.
              </p>
            </div>
          </div>
          {managers.length === 0 ? (
            <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
              אין מנהלי סניף או סגני מנהל להגדרה.
            </Card>
          ) : (
            <div className="grid gap-3">
              {managers.map((m) => (
                <ManagerPermsCard key={m.id} userId={m.id} name={m.full_name} role={m.role} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ManagerPermsCard({
  userId,
  name,
  role,
}: {
  userId: string;
  name: string;
  role: AppRole;
}) {
  const qc = useQueryClient();
  const save = useServerFn(setUserPermissions);

  const q = useQuery({
    queryKey: ["user-perms", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_task_permissions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [state, setState] = useState<Record<PermKey, boolean>>({
    can_create_tasks: false,
    can_edit_tasks: false,
    can_delete_tasks: false,
    can_approve_tasks: false,
    can_create_schedule: false,
    can_approve_schedule: false,
    can_publish_schedule: false,
    can_approve_leave: false,
    can_view_breaks: false,
    can_manage_breaks: false,
    can_send_messages: false,
  });


  useEffect(() => {
    if (!q.data) return;
    const d: any = q.data;
    setState({
      can_create_tasks: !!(d.can_create_tasks || d.can_manage_tasks),
      can_edit_tasks: !!(d.can_edit_tasks || d.can_manage_tasks),
      can_delete_tasks: !!(d.can_delete_tasks || d.can_manage_tasks),
      can_approve_tasks: !!(d.can_approve_tasks || d.can_manage_tasks),
      can_create_schedule: !!d.can_create_schedule,
      can_approve_schedule: !!d.can_approve_schedule,
      can_publish_schedule: !!d.can_publish_schedule,

      can_approve_leave: !!d.can_approve_leave,
      can_view_breaks: !!d.can_view_breaks,
      can_manage_breaks: !!d.can_manage_breaks,
      can_send_messages: !!d.can_send_messages,
    });
  }, [q.data]);

  const mut = useMutation({
    mutationFn: (next: Record<PermKey, boolean>) =>
      save({ data: { user_id: userId, perms: next } }),
    onSuccess: () => {
      toast.success("ההרשאות עודכנו");
      qc.invalidateQueries({ queryKey: ["user-perms", userId] });
      qc.invalidateQueries({ queryKey: ["task-perm"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  function toggle(k: PermKey, v: boolean) {
    const next = { ...state, [k]: v };
    setState(next);
    mut.mutate(next);
  }

  return (
    <Card className="card-elevated p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</p>
        </div>
        {mut.isPending && <Loader2 className="size-4 animate-spin text-primary" />}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {GRANULAR_PERMS.map((p) => (
          <div
            key={p.key}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border"
          >
            <Label htmlFor={`${userId}-${p.key}`} className="text-sm cursor-pointer">
              {p.label}
            </Label>
            <Switch
              id={`${userId}-${p.key}`}
              checked={state[p.key]}
              onCheckedChange={(v) => toggle(p.key, v)}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

