import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  canManageUsers,
  type AppRole,
} from "@/lib/constants";
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
  Sun,
  Megaphone,
  Package,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { setUserPermissions, resetUserPermissions, listBranchPermissionOverrides } from "@/lib/tasks.functions";
import { changeUserRole } from "@/lib/employees.functions";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/permissions")({
  component: PermissionsPage,
});

interface Row {
  id: string;
  full_name: string;
  department_name: string;
  role: AppRole;
}

type PermDef = { key: string; label: string; description: string };
type Category = {
  id: string;
  title: string;
  icon: typeof Users;
  perms: PermDef[];
};

const CATEGORIES: Category[] = [
  {
    id: "employees",
    title: "עובדים",
    icon: Users,
    perms: [
      { key: "can_view_all_employees", label: "צפייה בכל העובדים", description: "מאפשר למשתמש לצפות בכל עובדי החברה ללא אפשרות לערוך אותם." },
      { key: "can_view_employee_details", label: "צפייה בפרטי עובד", description: "מאפשר לפתוח כרטיס עובד ולראות את הפרטים האישיים שלו." },
      { key: "can_add_employee", label: "הוספת עובד", description: "מאפשר ליצור משתמשי עובדים חדשים במערכת." },
      { key: "can_edit_employee", label: "עריכת עובד", description: "מאפשר לשנות פרטים של עובד קיים (שם, מחלקה, טלפון וכו')." },
      { key: "can_delete_employee", label: "מחיקת עובד", description: "מאפשר להסיר עובדים מהמערכת כולל כל הנתונים שלהם." },
      { key: "can_reset_employee_password", label: "איפוס סיסמת עובד", description: "מאפשר ליצור סיסמה זמנית לעובד שאיבד גישה." },
      { key: "can_manage_departments", label: "ניהול מחלקות", description: "מאפשר יצירה, עריכה ומחיקה של מחלקות בארגון." },
      { key: "can_export_employees", label: "ייצוא רשימת עובדים", description: "מאפשר להוריד רשימת עובדים לקובץ חיצוני." },
    ],
  },
  {
    id: "schedules",
    title: "סידורי עבודה",
    icon: Calendar,
    perms: [
      { key: "can_view_schedule", label: "צפייה בסידורי עבודה", description: "מאפשר לראות סידורי עבודה של מחלקות." },
      { key: "can_create_schedule", label: "יצירת סידור עבודה", description: "מאפשר ליצור סידור עבודה שבועי חדש." },
      { key: "can_edit_schedule", label: "עריכת סידור עבודה", description: "מאפשר לשנות סידור עבודה קיים לפני אישורו." },
      { key: "can_approve_schedule", label: "אישור סידור עבודה", description: "מאפשר לאשר סידור עבודה ששלח אחראי מחלקה." },
      { key: "can_publish_schedule", label: "פרסום סידור עבודה", description: "מאפשר לאשר ולפרסם סידור עבודה ישירות לעובדים." },
    ],
  },
  {
    id: "leave",
    title: "חופשות",
    icon: Palmtree,
    perms: [
      { key: "can_view_leave", label: "צפייה בבקשות חופשה", description: "מאפשר לראות בקשות חופשה שעובדים שלחו." },
      { key: "can_approve_leave", label: "אישור חופשות", description: "מאפשר לאשר בקשת חופשה." },
      { key: "can_reject_leave", label: "דחיית חופשות", description: "מאפשר לדחות בקשת חופשה." },
      { key: "can_edit_leave_balance", label: "עריכת יתרת חופשה", description: "מאפשר לשנות את מספר ימי החופשה שעומדים לרשות עובד." },
    ],
  },
  {
    id: "breaks",
    title: "הפסקות",
    icon: Coffee,
    perms: [
      { key: "can_view_breaks", label: "צפייה בעובדים בהפסקה", description: "מאפשר לראות אילו עובדים נמצאים בהפסקה כרגע." },
      { key: "can_manage_breaks", label: "ניהול הפסקות", description: "מאפשר יצירה, עריכה ומחיקה של בקשות הפסקה." },
    ],
  },
  {
    id: "tasks",
    title: "משימות",
    icon: ListChecks,
    perms: [
      { key: "can_view_tasks", label: "צפייה במשימות", description: "מאפשר לראות את כל המשימות במערכת." },
      { key: "can_create_tasks", label: "יצירת משימות", description: "מאפשר להקים משימות חדשות ולשבץ אליהן עובדים." },
      { key: "can_edit_tasks", label: "עריכת משימות", description: "מאפשר לעדכן פרטי משימה קיימת." },
      { key: "can_delete_tasks", label: "מחיקת משימות", description: "מאפשר למחוק משימות מהמערכת." },
      { key: "can_approve_tasks", label: "אישור משימות (כשהיוצר הוא אחראי מחלקה)", description: "מאפשר לאשר השלמת משימה שיצר אחראי מחלקה." },
    ],
  },
  {
    id: "messages",
    title: "מרכז תקשורת",
    icon: MessageSquare,
    perms: [
      { key: "can_view_messages", label: "צפייה בהודעות", description: "מאפשר לפתוח את מרכז התקשורת ולקרוא הודעות שהתקבלו." },
      { key: "can_send_messages", label: "שליחת הודעות", description: "הרשאת בסיס לשליחת הודעות מתוך המערכת." },
      { key: "can_send_message_employee", label: "שליחת הודעה לעובד", description: "מאפשר לשלוח הודעה אישית לעובד בודד." },
      { key: "can_send_message_department", label: "שליחת הודעה למחלקה", description: "מאפשר לשלוח הודעה לכל עובדי מחלקה." },
      { key: "can_send_message_all", label: "שליחת הודעה לכל העובדים", description: "מאפשר לשלוח הודעה לכל עובדי החברה." },
      { key: "can_manage_communications", label: "ניהול מרכז התקשורת", description: "מאפשר לערוך ולמחוק הודעות של אחרים, וצפייה בלוג הפעילות." },
      { key: "can_delete_communications", label: "מחיקת הודעות", description: "מאפשר למחוק הודעות (כולל מחיקה לצמיתות)." },
      { key: "can_view_read_receipts", label: "צפייה באישורי קריאה", description: "מאפשר לראות מי קרא הודעות ומי טרם קרא." },
    ],
  },
  {
    id: "reports",
    title: "דוחות",
    icon: BarChart3,
    perms: [
      { key: "can_view_reports", label: "צפייה בדוחות", description: "מאפשר לצפות בדוחות הניהול של המערכת." },
      { key: "can_export_reports", label: "ייצוא דוחות", description: "מאפשר להוריד דוחות לקובץ חיצוני." },
    ],
  },
  {
    id: "recognition",
    title: "הוקרת עובדים",
    icon: Trophy,
    perms: [
      { key: "can_manage_employee_of_month", label: "🏆 ניהול עובד החודש", description: "מאפשר לבחור עובדים מצטיינים לחודש, לעדכן סיבת בחירה, להעלות תמונות ולמחוק רשומות." },
    ],
  },
  {
    id: "morning_board",
    title: "לוח ראשי",
    icon: Megaphone,
    perms: [
      { key: "can_manage_morning_board", label: "📢 ניהול תוכן לוח ראשי", description: "מאפשר להוסיף, לערוך, לסדר ולמחוק את פריטי הלוח הראשי של הסניף — תמונות, סרטונים והודעות. ניתן להעניק רק לאחראי סניף או סגן אחראי." },
    ],
  },
  {
    id: "custody",
    title: "מערכת ניהול ציוד",
    icon: Package,
    perms: [
      { key: "can_create_custody", label: "הוספת ציוד", description: "מאפשר להוסיף פריטי ציוד חדשים (לדוגמה: ציוד 1, ציוד 2). ניתן להעניק למנהל סניף או סגן מנהל." },
      { key: "can_edit_custody", label: "עריכת ציוד", description: "מאפשר לשנות שם, סדר ותזכורות של פריטי ציוד קיימים." },
      { key: "can_delete_custody", label: "השבתת/מחיקת ציוד", description: "מאפשר להשבית פריט ציוד שלא בשימוש." },
      { key: "can_return_custody", label: "החזרת ציוד בשם עובד", description: "מאפשר להחזיר ציוד שעובד אחר לקח. מנהל סניף תמיד יכול — הרשאה זו מיועדת בעיקר לסגן מנהל." },
      { key: "can_receive_custody_alerts", label: "קבלת התראות ציוד", description: "מקבל התראה כשעובד סיים משמרת ועדיין מחזיק ציוד, או לפני חצות." },
      { key: "can_configure_custody", label: "הגדרות מערכת ציוד", description: "מאפשר לעדכן זמני תזכורת, איפוס לוג יומי והתראות חצות." },
      { key: "can_view_custody_daily_log", label: "צפייה בלוג יומי", description: "מאפשר לצפות בלוג השימוש היומי בציוד (מתאפס לפי הגדרות הסניף)." },
      { key: "can_run_custody_monthly_report", label: "דוח חודשי ציוד", description: "מאפשר להפיק דוח חודשי ולארכב נתוני ציוד." },
    ],
  },
  {
    id: "system",
    title: "מערכת",
    icon: Cog,
    perms: [
      { key: "can_manage_permissions", label: "ניהול הרשאות", description: "מאפשר לקבוע אילו הרשאות יש לכל משתמש." },
      { key: "can_manage_company_settings", label: "ניהול הגדרות חברה", description: "מאפשר לעדכן שם חברה, לוגו, צבעים ופרטי קשר." },
      { key: "can_view_activity_log", label: "צפייה בלוג פעילות", description: "מאפשר לצפות בהיסטוריית הפעולות במערכת." },
      { key: "can_manage_users", label: "ניהול משתמשים", description: "מאפשר ניהול חשבונות משתמשים ותפקידיהם." },
    ],
  },
];

const ALL_PERM_KEYS = CATEGORIES.flatMap((c) => c.perms.map((p) => p.key));

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
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const isMainAdmin = !!me?.roles.includes("main_admin");
  const isBranchManager = !!me?.roles.includes("branch_manager");
  const allowed = me ? canManageUsers(me.roles) : false;
  const roleOptions = isMainAdmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((r) => r !== "main_admin" && r !== "branch_manager");
  const canEditRowRole = (row: Row) =>
    row.id !== me?.id &&
    !roleMutation.isPending &&
    (isMainAdmin || (isBranchManager && row.role !== "main_admin" && row.role !== "branch_manager"));

  const query = useQuery({
    enabled: allowed,
    queryKey: ["permissions-list"],
    queryFn: async () => {
      const [{ data: profiles, error: pe }, { data: roles, error: re }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, department_id, branch_id, departments(name)")
          .order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pe) throw pe;
      if (re) throw re;
      const roleMap: Record<string, AppRole> = {};
      (roles ?? []).forEach((r) => (roleMap[r.user_id] = r.role as AppRole));
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
      toast.success("ההרשאה עודכנה");
      qc.invalidateQueries({ queryKey: ["permissions-list"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      qc.invalidateQueries({ queryKey: ["user-perms"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  if (!allowed) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">רק בעל המערכת יכול לנהל הרשאות.</p>
      </Card>
    );
  }

  const managers = (query.data ?? []).filter((r) =>
    isMainAdmin
      ? r.role === "branch_manager" || r.role === "assistant_manager"
      : r.role === "assistant_manager",
  );

  const listOverridesFn = useServerFn(listBranchPermissionOverrides);
  const overridesQ = useQuery({
    enabled: allowed,
    queryKey: ["permission-overrides"],
    queryFn: () => listOverridesFn(),
  });

  const overrideRows = (overridesQ.data ?? []).filter(
    (row) =>
      row.staleRole ||
      row.hasScheduleOverride ||
      row.hasTaskOverride ||
      row.hasCustodyOverride,
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <header className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">ניהול הרשאות</h1>
            <p className="text-sm text-muted-foreground mt-1">קביעת תפקיד מערכת והרשאות מפורטות לכל עובד</p>
          </div>
        </header>

        {query.isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid gap-3">
            {query.data?.filter((row) => isMainAdmin || (row.role !== "main_admin" && row.role !== "branch_manager")).map((row) => (
              <Card key={row.id} className="card-elevated p-4 flex flex-wrap items-center gap-4">
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
                    disabled={!canEditRowRole(row)}
                    onValueChange={(v) => roleMutation.mutate({ userId: row.id, role: v as AppRole })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {row.id === me?.id ? (
                    <p className="text-[10px] text-muted-foreground mt-1 text-center">אינך יכול לערוך את עצמך</p>
                  ) : null}
                </div>
                {row.role === "assistant_manager" &&
                  (isMainAdmin || isBranchManager) &&
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
              <h2 className="text-xl font-bold">הרשאות נוספות פעילות</h2>
              <p className="text-sm text-muted-foreground mt-1">
                עובדים עם הרשאות ציוד, סידור או משימות (או הרשאות ישנות) שלא תואמות את תפקידם — ניתן להסיר מכאן.
              </p>
            </div>
            <div className="grid gap-3">
              {overrideRows.map((row) => (
                <Card key={row.id} className="card-elevated p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{row.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[row.role as AppRole] ?? row.role}
                      {row.staleRole ? " · הרשאות ישנות" : ""}
                      {row.hasCustodyOverride ? " · הרשאות ציוד פעילות" : ""}
                      {row.hasScheduleOverride ? " · הרשאות סידור פעילות" : ""}
                      {row.hasTaskOverride ? " · הרשאות משימות פעילות" : ""}
                    </p>
                  </div>
                  <ResetPermissionsButtons userId={row.id} compact />
                </Card>
              ))}
            </div>
          </section>
        )}

        {(isMainAdmin || isBranchManager) && (
          <section className="space-y-3">
            <div className="flex items-center gap-3 mt-8">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Settings2 className="size-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold">הרשאות מפורטות למנהלים</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  הענקה/הסרה של הרשאות פעולה לסגני מנהל בסניף. השינוי נשמר ונכנס לתוקף מיד.
                </p>
              </div>
              {managers.length >= 2 && <CopyPermsButton managers={managers} />}
            </div>
            {managers.length === 0 ? (
              <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
                אין סגני מנהל להגדרה.
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
  const qc = useQueryClient();
  const resetFn = useServerFn(resetUserPermissions);
  const mut = useMutation({
    mutationFn: (
      mode: "role_default" | "clear_all" | "schedules_only" | "tasks_only" | "custody_only",
    ) => resetFn({ data: { user_id: userId, mode } }),
    onSuccess: () => {
      toast.success("ההרשאות אופסו");
      qc.invalidateQueries({ queryKey: ["user-perms", userId] });
      qc.invalidateQueries({ queryKey: ["permission-overrides"] });
      qc.invalidateQueries({ queryKey: ["task-perm"] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
      qc.invalidateQueries({ queryKey: ["custody-caps"] });
      onDone?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
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
        הסרת הרשאות ציוד
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
        הסרת הרשאות סידור
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
        איפוס לברירת מחדל
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-xs h-8"
        disabled={mut.isPending}
        onClick={() => mut.mutate("clear_all")}
      >
        הסרת כל ההרשאות
      </Button>
    </div>
  );
}

function PermLabel({ def }: { def: PermDef }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-sm truncate">{def.label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="מידע">
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-right leading-relaxed">
          {def.description}
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
      toast.success("ההרשאות עודכנו");
      qc.invalidateQueries({ queryKey: ["user-perms", userId] });
      qc.invalidateQueries({ queryKey: ["task-perm"] });
      qc.invalidateQueries({ queryKey: ["custody-caps"] });
      qc.invalidateQueries({ queryKey: ["permission-overrides"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "שגיאה");
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
  const filtered: Category[] = useMemo(() => {
    if (!term) return CATEGORIES;
    return CATEGORIES
      .map((c) => ({
        ...c,
        perms: c.perms.filter(
          (p) =>
            p.label.toLowerCase().includes(term) ||
            p.description.toLowerCase().includes(term),
        ),
      }))
      .filter((c) => c.perms.length > 0);
  }, [term]);

  return (
    <Card className="card-elevated p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</p>
        </div>
        {mut.isPending && <Loader2 className="size-4 animate-spin text-primary" />}
      </div>

      <ResetPermissionsButtons userId={userId} />

      <div className="relative mb-3">
        <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש הרשאה…"
          className="pr-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">לא נמצאו הרשאות מתאימות.</p>
      ) : (
        <Accordion type="multiple" defaultValue={term ? filtered.map((c) => c.id) : []} className="w-full">
          {filtered.map((cat) => {
            const Icon = cat.icon;
            const onCount = cat.perms.filter((p) => state[p.key]).length;
            return (
              <AccordionItem key={cat.id} value={cat.id}>
                <AccordionTrigger className="py-3">
                  <div className="flex items-center gap-2 flex-1">
                    <Icon className="size-4 text-primary" />
                    <span className="font-medium">{cat.title}</span>
                    <span className="text-xs text-muted-foreground ms-auto me-2">
                      {onCount}/{cat.perms.length}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {cat.perms.map((p) => (
                      <div
                        key={p.key}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-card"
                      >
                        <Label htmlFor={`${userId}-${p.key}`} className="cursor-pointer flex-1 min-w-0">
                          <PermLabel def={p} />
                        </Label>
                        <Switch
                          id={`${userId}-${p.key}`}
                          checked={!!state[p.key]}
                          onCheckedChange={(v) => toggle(p.key, v)}
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
      toast.success("ההרשאות הועתקו בהצלחה");
      qc.invalidateQueries({ queryKey: ["user-perms", toId] });
      qc.invalidateQueries({ queryKey: ["task-perm"] });
      setConfirm(false);
      setOpen(false);
      setFromId("");
      setToId("");
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בהעתקה");
    } finally {
      setBusy(false);
    }
  }

  const toLabel = (id: string) => managers.find((m) => m.id === id)?.full_name ?? "";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Copy className="size-4" />
        העתק הרשאות מתפקיד קיים
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>העתקת הרשאות</DialogTitle>
            <DialogDescription>
              בחר ממי להעתיק ולמי להדביק. רק הרשאות יועתקו — לא משתמשים, עובדים, מחלקות או נתונים אחרים.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>העתק הרשאות מתוך</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger><SelectValue placeholder="בחירת משתמש" /></SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name} ({ROLE_LABELS[m.role]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>הדבק הרשאות אל</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger><SelectValue placeholder="בחירת משתמש" /></SelectTrigger>
                <SelectContent>
                  {managers
                    .filter((m) => m.id !== fromId)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name} ({ROLE_LABELS[m.role]})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
            <Button onClick={() => setConfirm(true)} disabled={!fromId || !toId || fromId === toId}>
              המשך
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>אישור העתקה</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תחליף את כל ההרשאות של <strong>{toLabel(toId)}</strong> בהרשאות של <strong>{toLabel(fromId)}</strong>. האם להמשיך?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={doCopy} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "אישור והעתקה"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
