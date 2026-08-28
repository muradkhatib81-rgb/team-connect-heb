import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  getRoleLabel,
  ROLE_OPTIONS,
  type AppRole,
} from "@/lib/constants";
import { useTranslation } from "react-i18next";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  ShieldCheck,
  Settings2,
  Search,
  Info,
  Copy,
  Users,
  Calendar,
  Palmtree,
  Coffee,
  ListChecks,
  MessageSquare,
  BarChart3,
  Cog,
  Trophy,
  Megaphone,
  Package,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { setUserPermissions, resetUserPermissions, listBranchPermissionOverrides } from "@/lib/tasks.functions";
import { changeUserRole } from "@/lib/employees.functions";
import { useEffect, useMemo, useState } from "react";
import {
  hasBranchActionPermission,
  useCurrentPermissions,
} from "@/lib/use-current-permissions";

export const Route = createFileRoute("/_authenticated/permissions")({
  component: PermissionsPage,
});

interface Row {
  id: string;
  full_name: string;
  department_name: string;
  role: AppRole;
}

type CategoryDef = {
  id: string;
  icon: typeof Users;
  keys: string[];
};

const CATEGORY_DEFS: CategoryDef[] = [
  {
    id: "employees",
    icon: Users,
    keys: [
      "can_view_all_employees",
      "can_view_employee_details",
      "can_add_employee",
      "can_edit_employee",
      "can_delete_employee",
      "can_reset_employee_password",
      "can_manage_departments",
      "can_export_employees",
    ],
  },
  {
    id: "schedules",
    icon: Calendar,
    keys: [
      "can_view_schedule",
      "can_create_schedule",
      "can_edit_schedule",
      "can_approve_schedule",
      "can_publish_schedule",
      "can_manage_schedule",
    ],
  },
  {
    id: "leave",
    icon: Palmtree,
    keys: ["can_view_leave", "can_approve_leave", "can_reject_leave", "can_edit_leave_balance"],
  },
  {
    id: "breaks",
    icon: Coffee,
    keys: ["can_view_breaks", "can_manage_breaks"],
  },
  {
    id: "tasks",
    icon: ListChecks,
    keys: [
      "can_view_tasks",
      "can_create_tasks",
      "can_edit_tasks",
      "can_delete_tasks",
      "can_approve_tasks",
    ],
  },
  {
    id: "messages",
    icon: MessageSquare,
    keys: [
      "can_view_messages",
      "can_send_messages",
      "can_send_message_employee",
      "can_send_message_department",
      "can_send_message_all",
      "can_manage_communications",
      "can_delete_communications",
      "can_view_read_receipts",
    ],
  },
  {
    id: "reports",
    icon: BarChart3,
    keys: ["can_view_reports", "can_export_reports"],
  },
  {
    id: "recognition",
    icon: Trophy,
    keys: ["can_manage_employee_of_month"],
  },
  {
    id: "morning_board",
    icon: Megaphone,
    keys: ["can_manage_morning_board"],
  },
  {
    id: "custody",
    icon: Package,
    keys: [
      "can_create_custody",
      "can_edit_custody",
      "can_delete_custody",
      "can_return_custody",
      "can_receive_custody_alerts",
      "can_configure_custody",
      "can_view_custody_daily_log",
      "can_run_custody_monthly_report",
    ],
  },
  {
    id: "system",
    icon: Cog,
    keys: [
      "can_manage_permissions",
      "can_manage_company_settings",
      "can_view_activity_log",
      "can_manage_users",
    ],
  },
];

const ALL_PERM_KEYS = CATEGORY_DEFS.flatMap((c) => c.keys);

const DEFAULT_MANAGER_PERMS: Record<string, boolean> = {
  can_view_dashboard: true,
  can_view_all_employees: true,
  can_view_employee_details: true,
  can_view_schedule: true,
  can_view_tasks: true,
};

function buildEmptyPerms(): Record<string, boolean> {
  const o: Record<string, boolean> = { can_view_dashboard: false };
  for (const k of ALL_PERM_KEYS) o[k] = false;
  return o;
}

export function PermissionsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const isMainAdmin = !!me?.roles.includes("main_admin");
  const isPlatformOwner =
    isMainAdmin || !!me?.roles.includes("system_admin");
  const ownPermissionsQ = useCurrentPermissions(me?.id);
  const allowed = me
    ? hasBranchActionPermission(
        me.roles,
        ownPermissionsQ.data,
        "can_manage_permissions",
      )
    : false;
  const canEditRoles = me
    ? hasBranchActionPermission(me.roles, ownPermissionsQ.data, "can_manage_users")
    : false;
  const roleOptions = isPlatformOwner
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((r) => r !== "main_admin" && r !== "branch_manager");
  const canEditRowRole = (row: Row) =>
    row.id !== me?.id &&
    !roleMutation.isPending &&
    canEditRoles &&
    (isPlatformOwner || (row.role !== "main_admin" && row.role !== "branch_manager"));

  const query = useQuery({
    enabled: allowed,
    queryKey: ["permissions-list"],
    queryFn: async () => {
      const [{ data: profiles, error: pe }, { data: roles, error: re }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, department_id, branch_id, departments(name)")
          .order("full_name"),
        supabase.rpc("list_visible_user_roles"),
      ]);
      if (pe) throw pe;
      if (re) throw re;
      const rolePriority: AppRole[] = [
        "system_admin",
        "main_admin",
        "branch_manager",
        "assistant_manager",
        "department_manager",
        "employee",
      ];
      const roleMap: Record<string, AppRole> = {};
      const bestRank: Record<string, number> = {};
      (roles ?? []).forEach((r) => {
        if (!r) return;
        const role = r.role as AppRole;
        const rank = rolePriority.indexOf(role);
        const normalized = rank === -1 ? rolePriority.length : rank;
        if (bestRank[r.user_id] !== undefined && bestRank[r.user_id] <= normalized) return;
        bestRank[r.user_id] = normalized;
        roleMap[r.user_id] = role;
      });
      return (profiles ?? [])
        .filter((p: any) => !isNonEmployeeIdentity(p))
        .map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        department_name: p.departments?.name ?? "—",
        role: roleMap[p.id] ?? "employee",
      })) as Row[];
    },
  });

  const changeRoleFn = useServerFn(changeUserRole);

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      await changeRoleFn({ data: { user_id: userId, role } });
    },
    onSuccess: () => {
      toast.success(t("permissions.roleUpdated"));
      qc.invalidateQueries({ queryKey: ["permissions-list"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      qc.invalidateQueries({ queryKey: ["user-perms"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.error")),
  });

  if (!allowed) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">{t("permissions.noAccessTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-2">{t("permissions.noAccessDesc")}</p>
      </Card>
    );
  }

  // Granular grants for assistants always; branch managers only for platform owners.
  const managers = (query.data ?? []).filter(
    (r) =>
      r.role === "assistant_manager" ||
      (isPlatformOwner && r.role === "branch_manager"),
  );

  const listOverridesFn = useServerFn(listBranchPermissionOverrides);
  const overridesQ = useQuery({
    enabled: allowed,
    queryKey: ["permission-overrides"],
    queryFn: () => listOverridesFn(),
  });

  const overrideRows = (overridesQ.data ?? []).filter(
    (row) =>
      row != null &&
      (row.staleRole ||
        row.hasScheduleOverride ||
        row.hasTaskOverride ||
        row.hasCustodyOverride),
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <header className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{t("permissions.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("permissions.subtitle")}</p>
          </div>
        </header>

        {query.isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid gap-3">
            {query.data?.filter((row) => isPlatformOwner || (row.role !== "main_admin" && row.role !== "branch_manager")).map((row) => (
              <Card key={row.id} className="card-elevated p-4 flex flex-wrap items-center gap-4">
                <div className="size-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-semibold shrink-0">
                  {row.full_name?.charAt(0) || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{row.full_name || t("permissions.noName")}</p>
                  <p className="text-xs text-muted-foreground">{row.department_name}</p>
                </div>
                <div className="w-40 shrink-0">
                  <Select
                    value={row.role}
                    disabled={!canEditRowRole(row)}
                    onValueChange={(v) => roleMutation.mutate({ userId: row.id, role: v as AppRole })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {row.id === me?.id ? (
                    <p className="text-[10px] text-muted-foreground mt-1 text-center">{t("permissions.cannotEditSelf")}</p>
                  ) : null}
                </div>
                { (row.role === "assistant_manager" ||
                  (isPlatformOwner && row.role === "branch_manager")) &&
                  allowed &&
                  row.id !== me?.id && (
                    <ResetPermissionsButtons userId={row.id} compact />
                  )}
              </Card>
            ))}
          </div>
        )}

        {overrideRows.length > 0 && (
          <section className="space-y-3">
            <div>
              <h2 className="text-xl font-bold">{t("permissions.activeOverridesTitle")}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t("permissions.activeOverridesDesc")}
              </p>
            </div>
            <div className="grid gap-3">
              {overrideRows.map((row) => (
                <Card key={row.id} className="card-elevated p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{row.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {getRoleLabel(row.role as AppRole) ?? row.role}
                      {row.staleRole ? ` · ${t("permissions.staleRole")}` : ""}
                      {row.hasCustodyOverride ? ` · ${t("permissions.custodyOverride")}` : ""}
                      {row.hasScheduleOverride ? ` · ${t("permissions.scheduleOverride")}` : ""}
                      {row.hasTaskOverride ? ` · ${t("permissions.taskOverride")}` : ""}
                    </p>
                  </div>
                  <ResetPermissionsButtons userId={row.id} compact />
                </Card>
              ))}
            </div>
          </section>
        )}

        {allowed && (
          <section className="space-y-3">
            <div className="flex items-center gap-3 mt-8">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Settings2 className="size-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold">{t("permissions.detailedTitle")}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {isPlatformOwner
                    ? t("permissions.detailedDescOwner")
                    : t("permissions.detailedDescBm")}
                </p>
              </div>
              {managers.length >= 2 && <CopyPermsButton managers={managers} />}
            </div>
            {managers.length === 0 ? (
              <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
                {isPlatformOwner
                  ? t("permissions.noManagersOwner")
                  : t("permissions.noManagersBm")}
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
    </TooltipProvider>
  );
}

function ResetPermissionsButtons({
  userId,
  onDone,
  compact,
}: {
  userId: string;
  onDone?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const resetFn = useServerFn(resetUserPermissions);
  const mut = useMutation({
    mutationFn: (
      mode: "role_default" | "clear_all" | "schedules_only" | "tasks_only" | "custody_only",
    ) => resetFn({ data: { user_id: userId, mode } }),
    onSuccess: () => {
      toast.success(t("permissions.permsReset"));
      qc.invalidateQueries({ queryKey: ["user-perms", userId] });
      qc.invalidateQueries({ queryKey: ["permission-overrides"] });
      qc.invalidateQueries({ queryKey: ["task-perm"] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
      qc.invalidateQueries({ queryKey: ["custody-caps"] });
      qc.invalidateQueries({ queryKey: ["current-user-permissions", userId] });
      onDone?.();
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.error")),
  });

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "justify-end" : "mb-3"}`}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-xs h-8"
        disabled={mut.isPending}
        onClick={() => mut.mutate("custody_only")}
      >
        <RotateCcw className="size-3.5 ml-1" />
        {t("permissions.resetCustody")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-xs h-8"
        disabled={mut.isPending}
        onClick={() => mut.mutate("schedules_only")}
      >
        <RotateCcw className="size-3.5 ml-1" />
        {t("permissions.resetSchedules")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-xs h-8"
        disabled={mut.isPending}
        onClick={() => mut.mutate("tasks_only")}
      >
        <RotateCcw className="size-3.5 ml-1" />
        {t("permissions.resetTasks")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-xs h-8"
        disabled={mut.isPending}
        onClick={() => mut.mutate("role_default")}
      >
        <RotateCcw className="size-3.5 ml-1" />
        {t("permissions.resetDefault")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-xs h-8"
        disabled={mut.isPending}
        onClick={() => mut.mutate("clear_all")}
      >
        {t("permissions.resetAll")}
      </Button>
    </div>
  );
}

function PermLabel({ permKey }: { permKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-sm truncate">{t(`permissions.perms.${permKey}.label`)}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" aria-label={t("permissions.infoAria")}>
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-right leading-relaxed">
          {t(`permissions.perms.${permKey}.description`)}
        </TooltipContent>
      </Tooltip>
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
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const save = useServerFn(setUserPermissions);
  const [search, setSearch] = useState("");

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

  const [state, setState] = useState<Record<string, boolean>>(buildEmptyPerms());

  useEffect(() => {
    const next = buildEmptyPerms();
    const d: any = q.data ?? {};
    for (const k of Object.keys(next)) next[k] = !!d[k];
    // Legacy compatibility — granular task perms also reflected by can_manage_tasks
    if (d.can_manage_tasks) {
      next.can_create_tasks = true;
      next.can_edit_tasks = true;
      next.can_delete_tasks = true;
      next.can_approve_tasks = true;
    }
    setState(next);
  }, [q.data]);

  const mut = useMutation({
    mutationFn: (next: Record<string, boolean>) =>
      save({ data: { user_id: userId, perms: next as any } }),
    onSuccess: () => {
      toast.success(t("permissions.permsUpdated"));
      qc.invalidateQueries({ queryKey: ["user-perms", userId] });
      qc.invalidateQueries({ queryKey: ["task-perm"] });
      qc.invalidateQueries({ queryKey: ["custody-caps"] });
      qc.invalidateQueries({ queryKey: ["current-user-permissions", userId] });
      qc.invalidateQueries({ queryKey: ["permission-overrides"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? t("common.error"));
      // Revert optimistic state on failure so the toggle reflects reality.
      qc.invalidateQueries({ queryKey: ["user-perms", userId] });
    },
  });

  function toggle(k: string, v: boolean) {
    const next = { ...state, [k]: v };
    setState(next);
    mut.mutate(next);
  }

  const term = search.trim().toLowerCase();
  const filtered: CategoryDef[] = useMemo(() => {
    if (!term) return CATEGORY_DEFS;
    return CATEGORY_DEFS.map((c) => ({
      ...c,
      keys: c.keys.filter((key) => {
        const label = t(`permissions.perms.${key}.label`).toLowerCase();
        const description = t(`permissions.perms.${key}.description`).toLowerCase();
        return label.includes(term) || description.includes(term);
      }),
    })).filter((c) => c.keys.length > 0);
  }, [term, t, i18n.language]);

  return (
    <Card className="card-elevated p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">{getRoleLabel(role)}</p>
        </div>
        {mut.isPending && <Loader2 className="size-4 animate-spin text-primary" />}
      </div>

      <ResetPermissionsButtons userId={userId} />

      <div className="relative mb-3">
        <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("permissions.searchPlaceholder")}
          className="pr-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t("permissions.noSearchResults")}</p>
      ) : (
        <Accordion type="multiple" defaultValue={term ? filtered.map((c) => c.id) : []} className="w-full">
          {filtered.map((cat) => {
            const Icon = cat.icon;
            const onCount = cat.keys.filter((key) => state[key]).length;
            return (
              <AccordionItem key={cat.id} value={cat.id}>
                <AccordionTrigger className="py-3">
                  <div className="flex items-center gap-2 flex-1">
                    <Icon className="size-4 text-primary" />
                    <span className="font-medium">{t(`permissions.categories.${cat.id}`)}</span>
                    <span className="text-xs text-muted-foreground ms-auto me-2">
                      {onCount}/{cat.keys.length}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {cat.keys.map((key) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-card"
                      >
                        <Label htmlFor={`${userId}-${key}`} className="cursor-pointer flex-1 min-w-0">
                          <PermLabel permKey={key} />
                        </Label>
                        <Switch
                          id={`${userId}-${key}`}
                          checked={!!state[key]}
                          onCheckedChange={(v) => toggle(key, v)}
                        />
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </Card>
  );
}

function CopyPermsButton({ managers }: { managers: Row[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save = useServerFn(setUserPermissions);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function doCopy() {
    if (!fromId || !toId || fromId === toId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("user_task_permissions")
        .select("*")
        .eq("user_id", fromId)
        .maybeSingle();
      if (error) throw error;
      const src: any = data ?? {};
      const next = buildEmptyPerms();
      for (const k of Object.keys(next)) next[k] = !!src[k];
      if (src.can_manage_tasks) {
        next.can_create_tasks = true;
        next.can_edit_tasks = true;
        next.can_delete_tasks = true;
        next.can_approve_tasks = true;
      }
      await save({ data: { user_id: toId, perms: next as any } });
      toast.success(t("permissions.copySuccess"));
      qc.invalidateQueries({ queryKey: ["user-perms", toId] });
      qc.invalidateQueries({ queryKey: ["task-perm"] });
      qc.invalidateQueries({ queryKey: ["current-user-permissions", toId] });
      setConfirm(false);
      setOpen(false);
      setFromId("");
      setToId("");
    } catch (e: any) {
      toast.error(e?.message ?? t("permissions.copyError"));
    } finally {
      setBusy(false);
    }
  }

  const toLabel = (id: string) => managers.find((m) => m.id === id)?.full_name ?? "";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Copy className="size-4" />
        {t("permissions.copyButton")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("permissions.copyTitle")}</DialogTitle>
            <DialogDescription>
              {t("permissions.copyDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("permissions.copyFrom")}</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger><SelectValue placeholder={t("permissions.selectUser")} /></SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name} ({getRoleLabel(m.role)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("permissions.copyTo")}</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger><SelectValue placeholder={t("permissions.selectUser")} /></SelectTrigger>
                <SelectContent>
                  {managers
                    .filter((m) => m.id !== fromId)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name} ({getRoleLabel(m.role)})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => setConfirm(true)} disabled={!fromId || !toId || fromId === toId}>
              {t("permissions.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("permissions.copyConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("permissions.copyConfirmDesc", { to: toLabel(toId), from: toLabel(fromId) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doCopy} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : t("permissions.copyConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
