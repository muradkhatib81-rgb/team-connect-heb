import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { publishAllWeekSchedules, getWeekDepartmentStates } from "@/lib/schedules.functions";
import { getDashboardTaskStats } from "@/lib/tasks.functions";
import { useEffect, useMemo, useState } from "react";
import {
  attentionSignatureFromIds,
  useDashboardCardAttention,
} from "@/lib/use-dashboard-card-attention";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  ROLE_LABELS,
  DEPARTMENT_LABELS,
  highestRole,
  isAdmin,
  isPlatformOwner,
  type AppRole,
} from "@/lib/constants";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Shared tile size for all dashboard summary/shortcut cards (matches leave cards). */
const DASH_TILE =
  "card-elevated flex h-full min-h-[4.75rem] p-3 transition-colors";
const DASH_TILE_ATTENTION =
  "border-2 border-destructive bg-destructive/10 ring-2 ring-destructive/40 hover:bg-destructive/15";
const DASH_TILE_GRID = "grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2";
const DASH_TILE_ICON =
  "flex size-8 shrink-0 items-center justify-center rounded-lg";
const DASH_TILE_TITLE = "text-sm font-semibold leading-tight";
const DASH_TILE_SUB =
  "mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground";
const DASH_TILE_TRAIL =
  "flex h-7 w-[4.75rem] shrink-0 items-center justify-end";
import { Users, Building2, Loader2, Plane, ListTodo, Clock, CheckCircle2, AlertTriangle, CalendarDays, User, Coffee, Send, UserPlus, Palmtree, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useLeaveAccess } from "@/lib/leave-permissions";
import { LEAVE_STATUS_LABEL } from "@/lib/leave.functions";
import { Link, useNavigate } from "@tanstack/react-router";
import { EmployeeOfMonthSection } from "@/components/employee-of-month-section";
import { DailyScheduleOverview } from "@/components/daily-schedule-overview";
import { formatHeDateTime } from "@/lib/date-format";
import {
  formatLeaveDateRange,
  isEmployeeCurrentlyOnLeave,
  leaveDecisionMessage,
} from "@/lib/employee-leave";
import { formatScheduleDayHe } from "@/lib/schedule-week";
import { resolveScheduleManagerCaps, resolveDashboardScheduleScope, scheduleScopeNeedsLoadedPermissions } from "@/lib/schedule-manager-caps";
import { CreateEmployeeDialog } from "./employees";
import { ManagementOnShiftCard } from "@/components/management-on-shift-card";
import { CustodyDashboardSection } from "@/components/custody-dashboard-section";
import { MorningBoard } from "@/components/morning-board";
import { LiveShiftCardsSection } from "@/components/live-shift-cards";
import {
  BREAK_PENDING_APPROVAL_STATUSES,
  BREAK_PRE_ACTIVE_STATUSES,
  BREAK_STATUS_LABEL,
  BREAK_STATUS_TONE,
  pickActiveBreak,
  pickPrimaryBreak,
  pickUpcomingBreak,
  fmtBreakTime,
  breakStartIso,
  todayJerusalemDate,
  useActivateDueBreaksPoll,
} from "@/lib/break-workflow";
import { useShiftSelfServiceVisible } from "@/lib/use-shift-self-service-visible";
import { fetchCanUserRequestBreak, useBreakRequiresApproval, useCanManageBreaks } from "@/lib/break-permissions";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  hasBranchActionPermission,
  useCurrentPermissions,
} from "@/lib/use-current-permissions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type DeptRow = { id: string; name: string; is_active: boolean };

function DashboardPage() {
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const admin = profile ? isAdmin(profile.roles) : false;
  const isDeptManager = profile ? profile.roles.includes("department_manager") : false;
  const permissionsQ = useCurrentPermissions(profile?.id);
  const scheduleCapsForBreaks = useMemo(
    () => resolveScheduleManagerCaps(profile?.roles ?? [], permissionsQ.data),
    [profile?.roles, permissionsQ.data],
  );
  const isDeptHeadOnlyBreaks = scheduleCapsForBreaks.isDeptHeadOnly;
  const canCreateEmployee = profile
    ? hasBranchActionPermission(
        profile.roles,
        permissionsQ.data,
        "can_add_employee",
      )
    : false;
  const canViewDepartments = profile
    ? hasBranchActionPermission(
        profile.roles,
        permissionsQ.data,
        "can_manage_departments",
      )
    : false;
  // Branch-level break overview only. Department heads use DeptHeadOnBreakSection
  // (own managed department) — they must not get the cross-department journal.
  const canViewBreaks = profile
    ? profile.roles.some((role) =>
        ["system_admin", "main_admin", "branch_manager"].includes(role),
      ) ||
      hasBranchActionPermission(
        profile.roles,
        permissionsQ.data,
        "can_view_breaks",
      ) ||
      hasBranchActionPermission(
        profile.roles,
        permissionsQ.data,
        "can_manage_breaks",
      )
    : false;
  const queryClient = useQueryClient();
  const fetchTaskStats = useServerFn(getDashboardTaskStats);
  const [deptDialogId, setDeptDialogId] = useState<string | null>(null);
  const [empDialogId, setEmpDialogId] = useState<string | null>(null);



  const statsQuery = useQuery({
    enabled: admin,
    queryKey: ["dashboard", "stats"],
    staleTime: 30_000,
    queryFn: async () => {
      const [
        { data: profs, error: pErr },
        { data: depts, error: dErr },
        { data: breaks, error: bErr },
      ] = await Promise.all([
        supabase.from("profiles").select("id, is_active, on_leave, leave_start_date, leave_end_date, department_id, branch_id, excluded_from_headcount"),
        supabase.from("departments").select("id, name, is_active").order("name"),
        supabase.from("break_requests").select("user_id").eq("status", "active"),
      ]);
      if (pErr) throw pErr;
      if (dErr) throw dErr;
      if (bErr) throw bErr;
      // Staff only: exclude platform-owner identities (no dept + no branch) and
      // anyone flagged "excluded from headcount". Applies for every viewer.
      const staff = (profs ?? []).filter((d: any) => !isNonEmployeeIdentity(d));
      const counted = staff.filter((d: any) => !d.excluded_from_headcount);
      const total = counted.length;
      const onLeave = counted.filter((d: any) => isEmployeeCurrentlyOnLeave(d)).length;
      const active = counted.filter((d: any) => d.is_active && !isEmployeeCurrentlyOnLeave(d)).length;
      const inactive = counted.filter((d: any) => !d.is_active).length;
      const excludedIds = new Set(staff.filter((d: any) => d.excluded_from_headcount).map((d: any) => d.id));
      const onBreak = new Set(
        (breaks ?? [])
          .map((b: any) => b.user_id as string)
          .filter((id) => !excludedIds.has(id)),
      ).size;
      const byDept: Record<string, number> = {};
      (depts as DeptRow[]).forEach((d) => (byDept[d.id] = 0));
      counted.forEach((p: any) => {
        if (p.department_id && byDept[p.department_id] !== undefined) {
          byDept[p.department_id] += 1;
        }
      });
      return { total, active, inactive, onLeave, onBreak, byDept, departments: depts as DeptRow[] };
    },
  });

  const departmentManagersQuery = useQuery({
    enabled: admin && canViewDepartments,
    queryKey: [
      "dashboard",
      "department-managers",
      activeBranchId ?? profile?.branch_id ?? "none",
    ],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: departments, error: departmentsError } = await supabase
        .from("departments")
        .select("id, manager_id");
      if (departmentsError) throw departmentsError;

      const managerIds = Array.from(
        new Set(
          (departments ?? [])
            .map((department) => department.manager_id)
            .filter((id): id is string => !!id),
        ),
      );
      const namesById = new Map<string, string>();

      if (managerIds.length > 0) {
        const { data: managers, error: managersError } = await supabase
          .from("profiles")
          .select("id, full_name, first_name, last_name")
          .in("id", managerIds);
        if (managersError) throw managersError;

        for (const manager of managers ?? []) {
          namesById.set(
            manager.id,
            manager.full_name ||
              [manager.first_name, manager.last_name].filter(Boolean).join(" ") ||
              "ללא שם",
          );
        }
      }

      return Object.fromEntries(
        (departments ?? []).map((department) => [
          department.id,
          department.manager_id
            ? namesById.get(department.manager_id) ?? "אחראי מחלקה לא זמין"
            : null,
        ]),
      ) as Record<string, string | null>;
    },
  });

  // Department manager: always reload their department employees on mount.
  // The manager is excluded from the employees list at the source (Query level).
  const deptManagerQuery = useQuery({
    enabled: !admin && isDeptManager && !!profile,
    queryKey: ["dashboard", "dept-manager", profile?.id],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: dept, error: dErr } = await supabase
        .from("departments")
        .select("id, name")
        .eq("manager_id", profile!.id)
        .maybeSingle();
      if (dErr) throw dErr;

      let employees: DeptEmp[] = [];
      let manager: {
        id: string;
        full_name: string;
        job_title: string | null;
        avatar_url: string | null;
      } | null = null;

      if (dept?.id) {
        const { data: emps, error: eErr } = await supabase
          .from("profiles")
          .select("id, full_name, is_active, on_leave, leave_start_date, leave_end_date, avatar_url, department_id, job_title")
          .eq("department_id", dept.id)
          .neq("id", profile!.id) // exclude the department manager themselves
          .order("full_name");
        if (eErr) throw eErr;
        employees = (emps ?? []) as DeptEmp[];

        const { data: mgr } = await supabase
          .from("profiles")
          .select("id, full_name, job_title, avatar_url, is_active, on_leave, leave_start_date, leave_end_date")
          .eq("id", profile!.id)
          .maybeSingle();
        if (mgr) manager = mgr as NonNullable<typeof manager>;
      }

      return { dept, employees, manager };
    },
  });


  // Tasks stats — server-side branch scope (client branch filter hid legacy/null rows).
  const tasksStatsQuery = useQuery({
    enabled: !!profile && (admin || isDeptManager),
    queryKey: ["dashboard", "tasks-stats", activeBranchId ?? profile?.branch_id ?? "none"],
    retry: false,
    staleTime: 30_000,
    queryFn: () => fetchTaskStats(),
  });

  if (!profile) return null;
  const top = highestRole(profile.roles);

  return (
    <div className="space-y-8">
      <MorningBoard />
      <ManagementOnShiftCard />
      <CustodyDashboardSection />

      <header>
        <p className="text-sm text-muted-foreground">שלום,</p>
        <h1 className="text-2xl sm:text-3xl font-bold mt-1">{profile.full_name}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {top && <Badge variant="secondary" className="rounded-full">{ROLE_LABELS[top]}</Badge>}
          <Badge variant="outline" className="rounded-full">
            {profile.department_name ?? "—"}
          </Badge>
          {!profile.is_active && (
            <Badge variant="destructive" className="rounded-full">לא פעיל</Badge>
          )}
        </div>
      </header>

      <DashboardLeaveBanner profile={profile} />

      <EmployeeOfMonthSection />

      <LiveShiftCardsSection />

      {(admin || isDeptManager) && <SchedulesStatsSection profile={profile} />}

      <DashboardSchedulePanel profile={profile} />

      {admin || isDeptManager ? (
        <>
          <BreakShortcutCard userId={profile.id} />
          <LeaveShortcutCard userId={profile.id} />
          {isDeptHeadOnlyBreaks && <DeptHeadOnBreakSection />}
          {/* Branch-level journal — never for dept-head-only (own-dept section above). */}
          {canViewBreaks && !isDeptHeadOnlyBreaks && (
            <OnBreakSection profile={profile} />
          )}

          {admin ? (
            <AdminDashboard
              stats={statsQuery.data}
              loading={statsQuery.isLoading}
              onSelectDept={setDeptDialogId}
              canCreateEmployee={canCreateEmployee}
              canViewDepartments={canViewDepartments}
              departmentManagerNames={departmentManagersQuery.data}
              currentUserRoles={profile.roles}
            />
          ) : (
            <DeptManagerDashboard data={deptManagerQuery.data} loading={deptManagerQuery.isLoading} />
          )}

          <TasksStatsSection
            stats={tasksStatsQuery.data}
            loading={tasksStatsQuery.isLoading}
            userId={profile.id}
          />

          <EmployeeNewMessagesCard userId={profile.id} />
        </>
      ) : (
        <EmployeeDashboard profile={profile} />
      )}

      <DepartmentEmployeesDialog
        deptId={deptDialogId}
        onClose={() => setDeptDialogId(null)}
        onSelectEmployee={setEmpDialogId}
      />
      <EmployeeProfileDialog
        employeeId={empDialogId}
        onClose={() => setEmpDialogId(null)}
      />
    </div>
  );
}

function DashboardLeaveBanner({ profile }: { profile: { leave_start_date?: string | null; leave_end_date?: string | null } & Parameters<typeof isEmployeeCurrentlyOnLeave>[0] }) {
  if (!isEmployeeCurrentlyOnLeave(profile)) return null;

  const start = profile.leave_start_date?.slice(0, 10) ?? null;
  const end = profile.leave_end_date?.slice(0, 10) ?? null;
  const rangeLabel =
    start && end
      ? `${formatScheduleDayHe(start)} – ${formatScheduleDayHe(end)}`
      : formatLeaveDateRange(start, end);

  return (
    <Alert className="border-amber-300 bg-gradient-to-l from-amber-50 to-orange-50/80 shadow-sm">
      <Plane className="size-5 text-amber-700" />
      <AlertTitle className="text-amber-950 font-semibold text-base">את/ה בחופש כרגע</AlertTitle>
      <AlertDescription className="text-amber-900 space-y-1">
        {rangeLabel && (
          <p>
            תקופת החופשה: <span className="font-semibold">{rangeLabel}</span>
          </p>
        )}
        <p className="font-medium">מאחלים לך חזרה מהירה — מקווים שתחזור/תחזרי אלינו בהקדם האפשרי.</p>
      </AlertDescription>
    </Alert>
  );
}

function TasksStatsSection({
  stats,
  loading,
  userId,
}: {
  stats?: { open: number; in_progress: number; completed: number; overdue: number };
  loading: boolean;
  userId: string;
}) {
  const navigate = useNavigate();
  const [tasksOpen, setTasksOpen] = useState(false);

  const openSig = stats && stats.open > 0 ? `n:${stats.open}` : "";
  const progressSig = stats && stats.in_progress > 0 ? `n:${stats.in_progress}` : "";
  const doneSig = stats && stats.completed > 0 ? `n:${stats.completed}` : "";
  const overdueSig = stats && stats.overdue > 0 ? `n:${stats.overdue}` : "";
  const openAttn = useDashboardCardAttention(userId, "tasks-open", openSig);
  const progressAttn = useDashboardCardAttention(userId, "tasks-progress", progressSig);
  const doneAttn = useDashboardCardAttention(userId, "tasks-done", doneSig);
  const overdueAttn = useDashboardCardAttention(userId, "tasks-overdue", overdueSig);

  // Outer card lights when any inner bucket changes; clears when the section is opened.
  const sectionSig = [openSig, progressSig, doneSig, overdueSig].filter(Boolean).join("|");
  const sectionAttn = useDashboardCardAttention(userId, "tasks-section", sectionSig);

  if (loading || !stats) return null;

  const go = (status: string, markSeen: () => void) => {
    markSeen();
    navigate({ to: "/tasks", search: { status } as any });
  };

  const activeCount = stats.open + stats.in_progress + stats.overdue;
  const sectionNeedsAttention = sectionAttn.needsAttention;

  return (
    <section>
      <Collapsible
        open={tasksOpen}
        onOpenChange={(open) => {
          setTasksOpen(open);
          if (open) sectionAttn.markSeen();
        }}
      >
        <Card
          className={
            sectionNeedsAttention && !tasksOpen
              ? `card-elevated overflow-hidden ${DASH_TILE_ATTENTION}`
              : "card-elevated overflow-hidden"
          }
        >
          <div className="flex items-stretch gap-1 p-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-right outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className={
                    sectionNeedsAttention && !tasksOpen
                      ? `${DASH_TILE_ICON} bg-destructive/20 text-destructive`
                      : `${DASH_TILE_ICON} bg-primary/15 text-primary`
                  }
                >
                  <ListTodo className="size-4" />
                </div>
                <div className="min-w-0 flex-1 self-center">
                  <h3
                    className={
                      sectionNeedsAttention && !tasksOpen
                        ? `${DASH_TILE_TITLE} text-destructive`
                        : DASH_TILE_TITLE
                    }
                  >
                    משימות
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {activeCount > 0
                      ? `${activeCount} משימות פעילות · ${stats.completed} הוגשו`
                      : stats.completed > 0
                        ? `${stats.completed} הוגשו / הושלמו`
                        : "אין משימות פעילות כרגע"}
                  </p>
                </div>
                <div className={`${DASH_TILE_TRAIL} gap-1.5`}>
                  {sectionNeedsAttention && !tasksOpen ? (
                    <Badge variant="destructive" className="rounded-full px-2">
                      {Math.max(activeCount, 1)}
                    </Badge>
                  ) : null}
                  <ChevronDown
                    className={`size-4 text-muted-foreground transition-transform ${
                      tasksOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
            <Link
              to="/tasks"
              className="shrink-0 self-center px-2 text-xs text-primary hover:underline"
              onClick={() => sectionAttn.markSeen()}
            >
              לכל המשימות
            </Link>
          </div>

          <CollapsibleContent>
            <div className={`border-t p-3 ${DASH_TILE_GRID}`}>
              <StatCard
                label="פתוחות"
                value={stats.open}
                icon={ListTodo}
                tone="primary"
                badge={stats.open}
                attention={openAttn.needsAttention}
                onClick={() => go("new", openAttn.markSeen)}
              />
              <StatCard
                label="בביצוע"
                value={stats.in_progress}
                icon={Clock}
                tone="success"
                badge={stats.in_progress}
                attention={progressAttn.needsAttention}
                onClick={() => go("in_progress", progressAttn.markSeen)}
              />
              <StatCard
                label="הוגשו / הושלמו"
                value={stats.completed}
                icon={CheckCircle2}
                tone="muted"
                badge={stats.completed}
                attention={doneAttn.needsAttention}
                onClick={() => go("pending_approval", doneAttn.markSeen)}
              />
              <StatCard
                label="באיחור"
                value={stats.overdue}
                icon={AlertTriangle}
                tone="warning"
                badge={stats.overdue}
                attention={overdueAttn.needsAttention}
                onClick={() => go("overdue", overdueAttn.markSeen)}
              />
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </section>
  );
}

type DeptEmp = {
  id: string;
  full_name: string;
  is_active: boolean;
  on_leave: boolean;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
  avatar_url: string | null;
  department_id: string | null;
};

/** Active break whose planned end time has already passed. */
function isBreakOverdue(endsAt: string | null, nowMs = Date.now()) {
  if (!endsAt) return false;
  return new Date(endsAt).getTime() < nowMs;
}

function DeptHeadOnBreakSection() {
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const [listKind, setListKind] = useState<"onBreak" | "late" | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logEmpFilter, setLogEmpFilter] = useState("__all");
  const [logTypeFilter, setLogTypeFilter] = useState("__all");
  const [logStatusFilter, setLogStatusFilter] = useState("__all");
  const [onBreakTick, setOnBreakTick] = useState(0);
  const [breaksOpen, setBreaksOpen] = useState(false);

  const onBreakQ = useQuery({
    queryKey: ["dashboard-dept-on-break"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "list_managed_department_active_breaks",
      );
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        user_id: string;
        full_name: string;
        break_type: string;
        duration_minutes: number;
        started_at: string | null;
        ends_at: string | null;
        department_id: string;
        department_name: string;
      }[];
    },
    refetchInterval: 60_000,
  });

  // Full journal stays cached for the tile count; enrich only when dialog is open.
  const dailyLogQ = useQuery({
    queryKey: ["dashboard-dept-daily-breaks"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "list_managed_department_daily_breaks",
      );
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        user_id: string;
        full_name: string;
        job_title: string | null;
        break_type: string;
        duration_minutes: number;
        status: string;
        created_at: string | null;
        requested_at: string | null;
        planned_start: string | null;
        started_at: string | null;
        ends_at: string | null;
        completed_at: string | null;
        department_id: string;
        department_name: string;
        approver_name: string | null;
      }[];
    },
    staleTime: 60_000,
  });

  // RealtimeBridge already invalidates dept on-break / daily-breaks keys.

  useEffect(() => {
    // Tile late-split: 5s is enough. Open list keeps 1s for live overrun badges.
    if ((onBreakQ.data?.length ?? 0) === 0) return;
    const ms = listKind !== null ? 1000 : 5000;
    const t = setInterval(() => setOnBreakTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [onBreakQ.data?.length, listKind]);

  const list = onBreakQ.data ?? [];
  const log = dailyLogQ.data ?? [];
  const logCount = log.length;
  void onBreakTick;
  const nowMs = Date.now();
  const onBreakNow = list.filter((r) => !isBreakOverdue(r.ends_at, nowMs));
  const lateList = list.filter((r) => isBreakOverdue(r.ends_at, nowMs));
  const onBreakSig = attentionSignatureFromIds(onBreakNow.map((r) => r.id));
  const lateSig = attentionSignatureFromIds(lateList.map((r) => r.id));
  const onBreakAttn = useDashboardCardAttention(me?.id, "dept-on-break-now", onBreakSig);
  const lateAttn = useDashboardCardAttention(me?.id, "dept-on-break-late", lateSig);
  const journalSig = attentionSignatureFromIds(log.map((r) => r.id));
  const journalAttn = useDashboardCardAttention(me?.id, "dept-break-journal", journalSig);
  const sectionSig = [onBreakSig, lateSig, journalSig].filter(Boolean).join("|");
  const sectionAttn = useDashboardCardAttention(me?.id, "dept-breaks-section", sectionSig);
  const alertCount = onBreakNow.length + lateList.length;
  const sectionNeedsAttention = sectionAttn.needsAttention;
  const dialogList =
    listKind === "late" ? lateList : listKind === "onBreak" ? onBreakNow : [];
  const fmtT = (iso: string | null) => fmtBreakTime(iso) || "—";
  const deptName = list[0]?.department_name ?? log[0]?.department_name ?? null;

  const employees = logOpen
    ? Array.from(new Map(log.map((r) => [r.user_id, r.full_name])).entries()).sort((a, b) =>
        a[1].localeCompare(b[1], "he"),
      )
    : [];
  const types = logOpen ? Array.from(new Set(log.map((r) => r.break_type))).sort() : [];
  const statuses = logOpen ? Array.from(new Set(log.map((r) => r.status))) : [];

  const enriched = logOpen
    ? log.map((r) => {
    const startedMs = r.started_at ? new Date(r.started_at).getTime() : null;
    const endsMs = r.ends_at ? new Date(r.ends_at).getTime() : null;
    const completedMs = r.completed_at ? new Date(r.completed_at).getTime() : null;
    const displayStart = r.started_at ?? r.planned_start ?? r.requested_at;
    const actualDurMin =
      startedMs && completedMs
        ? Math.max(0, Math.round((completedMs - startedMs) / 60000))
        : null;
    const overrunMin =
      completedMs && endsMs && completedMs > endsMs
        ? Math.round((completedMs - endsMs) / 60000)
        : r.status === "active" && endsMs && Date.now() > endsMs
          ? Math.round((Date.now() - endsMs) / 60000)
          : 0;
    const returnedOnTime =
      r.status === "completed" && completedMs && endsMs && completedMs <= endsMs;
    const returnedLate = r.status === "completed" && overrunMin > 0;
    return {
      ...r,
      displayStart,
      actualDurMin,
      overrunMin,
      returnedOnTime: !!returnedOnTime,
      returnedLate,
    };
  })
    : [];

  const filtered = enriched.filter((r) => {
    if (logEmpFilter !== "__all" && r.user_id !== logEmpFilter) return false;
    if (logTypeFilter !== "__all" && r.break_type !== logTypeFilter) return false;
    if (logStatusFilter !== "__all" && r.status !== logStatusFilter) return false;
    if (logSearch.trim()) {
      const q = logSearch.trim().toLowerCase();
      const hay = [r.full_name, r.break_type, r.job_title, r.approver_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <>
      <Collapsible
        open={breaksOpen}
        onOpenChange={(open) => {
          setBreaksOpen(open);
          if (open) sectionAttn.markSeen();
        }}
      >
        <Card
          className={
            sectionNeedsAttention && !breaksOpen
              ? `card-elevated overflow-hidden ${DASH_TILE_ATTENTION}`
              : "card-elevated overflow-hidden"
          }
        >
          <div className="flex items-stretch gap-1 p-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-right outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className={
                    sectionNeedsAttention && !breaksOpen
                      ? `${DASH_TILE_ICON} bg-destructive/20 text-destructive`
                      : `${DASH_TILE_ICON} bg-primary/15 text-primary`
                  }
                >
                  <Coffee className="size-4" />
                </div>
                <div className="min-w-0 flex-1 self-center">
                  <h3
                    className={
                      sectionNeedsAttention && !breaksOpen
                        ? `${DASH_TILE_TITLE} text-destructive`
                        : DASH_TILE_TITLE
                    }
                  >
                    הפסקות
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {alertCount > 0
                      ? `${onBreakNow.length} בהפסקה · ${lateList.length} מאחרים · יומן ${logCount}`
                      : logCount > 0
                        ? `יומן היום: ${logCount}`
                        : "אין פעילות הפסקות כרגע"}
                  </p>
                </div>
                <div className={`${DASH_TILE_TRAIL} gap-1.5`}>
                  {sectionNeedsAttention && !breaksOpen ? (
                    <Badge variant="destructive" className="rounded-full px-2">
                      {Math.max(alertCount, logCount, 1)}
                    </Badge>
                  ) : null}
                  <ChevronDown
                    className={`size-4 text-muted-foreground transition-transform ${
                      breaksOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            <div className={`border-t p-3 ${DASH_TILE_GRID}`}>
              <StatCard
                label="עובדים בהפסקה כעת"
                value={onBreakNow.length}
                icon={Coffee}
                tone={onBreakNow.length > 0 ? "warning" : "primary"}
                badge={onBreakNow.length}
                attention={onBreakAttn.needsAttention}
                onClick={() => {
                  onBreakAttn.markSeen();
                  setListKind("onBreak");
                }}
              />
              <StatCard
                label="עובדים מאחרים מהפסקה"
                value={lateList.length}
                icon={AlertTriangle}
                tone="muted"
                badge={lateList.length}
                attention={lateAttn.needsAttention}
                onClick={() => {
                  lateAttn.markSeen();
                  setListKind("late");
                }}
              />
              <StatCard
                label="יומן הפסקות"
                value={logCount}
                icon={Coffee}
                tone="muted"
                badge={logCount}
                attention={journalAttn.needsAttention}
                onClick={() => {
                  journalAttn.markSeen();
                  setLogOpen(true);
                }}
              />
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Dialog
        open={listKind !== null}
        onOpenChange={(o) => {
          if (!o) setListKind(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="size-5 text-primary" />
              {listKind === "late" ? "עובדים מאחרים מהפסקה" : "עובדים בהפסקה כעת"}
              {deptName ? (
                <span className="text-xs font-normal text-muted-foreground mr-2">
                  · {deptName}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {onBreakQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : dialogList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {listKind === "late"
                ? "אין עובדים מאחרים מהפסקה במחלקה כרגע."
                : "אין עובדים בהפסקה במחלקה כרגע."}
            </p>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {dialogList.map((r) => {
                const now = Date.now();
                const endsTs = r.ends_at ? new Date(r.ends_at).getTime() : 0;
                const remainingMs = endsTs ? endsTs - now : 0;
                const overrunMs = endsTs && now > endsTs ? now - endsTs : 0;
                return (
                  <Card
                    key={r.id}
                    className={
                      "p-4 border " +
                      (overrunMs > 0
                        ? "border-red-500 bg-red-50 dark:bg-red-950/30"
                        : "border-border")
                    }
                  >
                    <div className="space-y-1">
                      <p className="font-semibold truncate">{r.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        סוג הפסקה: {r.break_type}
                        {r.duration_minutes ? ` · ${r.duration_minutes} דק׳` : ""}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        יצא: {fmtT(r.started_at)} · חזרה: {fmtT(r.ends_at)}
                      </p>
                      {overrunMs > 0 ? (
                        <Badge variant="destructive" className="mt-1">
                          חריגה +{fmtHMS(overrunMs)}
                        </Badge>
                      ) : endsTs ? (
                        <Badge variant="secondary" className="mt-1">
                          נותר {fmtHMS(Math.max(0, remainingMs))}
                        </Badge>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <Coffee className="size-5 text-primary" />
              📋 יומן ההפסקות
              {deptName ? (
                <Badge variant="secondary" className="rounded-full">
                  {deptName}
                </Badge>
              ) : null}
              <span className="text-xs font-normal text-muted-foreground">
                {new Intl.DateTimeFormat("he-IL", {
                  timeZone: "Asia/Jerusalem",
                  dateStyle: "full",
                  numberingSystem: "latn",
                  calendar: "gregory",
                }).format(new Date())}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <Input
              placeholder="🔎 חיפוש..."
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
            />
            <Select value={logEmpFilter} onValueChange={setLogEmpFilter}>
              <SelectTrigger>
                <SelectValue placeholder="עובד" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">כל עובדי המחלקה</SelectItem>
                {employees.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={logTypeFilter} onValueChange={setLogTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="סוג הפסקה" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">כל הסוגים</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={logStatusFilter} onValueChange={setLogStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="סטטוס" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">כל הסטטוסים</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {BREAK_STATUS_LABEL[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-auto max-h-[65vh] border rounded-md">
            {dailyLogQ.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground text-center">
                אין רשומות הפסקה במחלקה להיום.
              </p>
            ) : (
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-right p-2">עובד</th>
                    <th className="text-right p-2">סוג</th>
                    <th className="text-right p-2">התחלה</th>
                    <th className="text-right p-2">סיום מתוכנן</th>
                    <th className="text-right p-2">חזרה</th>
                    <th className="text-right p-2">חריגה</th>
                    <th className="text-right p-2">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const isLate = r.returnedLate;
                    const isOnTime = r.returnedOnTime;
                    const isActiveRow = r.status === "active";
                    const statusBadge = isActiveRow ? (
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                        בהפסקה
                      </Badge>
                    ) : isOnTime ? (
                      <Badge className="bg-green-600 text-white hover:bg-green-600">
                        חזר בזמן
                      </Badge>
                    ) : isLate ? (
                      <Badge className="bg-red-600 text-white hover:bg-red-600">
                        חזר באיחור
                      </Badge>
                    ) : (
                      <Badge variant={BREAK_STATUS_TONE[r.status] ?? "secondary"}>
                        {BREAK_STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    );
                    return (
                      <tr key={r.id} className="border-t align-top">
                        <td className="p-2 font-medium whitespace-nowrap">
                          {r.full_name}
                          {r.job_title ? (
                            <div className="text-[11px] text-muted-foreground font-normal">
                              {r.job_title}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2 whitespace-nowrap">{r.break_type}</td>
                        <td className="p-2 whitespace-nowrap">{fmtT(r.displayStart)}</td>
                        <td className="p-2 whitespace-nowrap">{fmtT(r.ends_at)}</td>
                        <td className="p-2 whitespace-nowrap">{fmtT(r.completed_at)}</td>
                        <td className="p-2 whitespace-nowrap">
                          {r.overrunMin > 0 ? (
                            <span className="text-red-600 font-bold">+{r.overrunMin} דק׳</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2">{statusBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            סה״כ: {filtered.length} מתוך {log.length}
            {deptName ? ` · מחלקה: ${deptName}` : ""}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeptManagerDashboard({
  data,
  loading,
}: {
  data?: {
    dept: { id: string; name: string } | null;
    employees: DeptEmp[];
    manager: { id: string; full_name: string; job_title: string | null; avatar_url: string | null } | null;
  };
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!data.dept) {
    return (
      <Card className="card-elevated p-6 text-sm text-muted-foreground">
        עדיין לא שויכת כאחראי מחלקה. פנה/י להנהלה.
      </Card>
    );
  }
  // Manager is already excluded at the Query level (see deptManagerQuery).
  const emps = data.employees;
  const mgrOnLeave = data.manager ? isEmployeeCurrentlyOnLeave(data.manager as DeptEmp) : false;
  const total = emps.length;
  const mgr = data.manager;
  const mgrInitial = (mgr?.full_name || "?").charAt(0);

  return (
    <>
      {mgr && (
        <Card className="card-elevated p-4">
          <div className="flex items-center gap-4">
            <div className="size-16 rounded-full bg-accent overflow-hidden flex items-center justify-center shrink-0 border border-border text-xl font-semibold text-muted-foreground">
              {mgr.avatar_url ? (
                <span>{mgrInitial}</span>
              ) : (
                <span>{mgrInitial}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">👤 אחראי המחלקה</div>
              <div className="font-semibold truncate">{mgr.full_name}</div>
              <div className="text-sm text-muted-foreground truncate flex items-center gap-2 flex-wrap">
                <span>
                  {data.dept.name}
                  {mgr.job_title ? ` · ${mgr.job_title}` : ""}
                </span>
                {mgrOnLeave && (
                  <Badge variant="secondary" className="rounded-full text-xs">בחופש</Badge>
                )}
              </div>
              {mgrOnLeave && formatLeaveDateRange((mgr as DeptEmp).leave_start_date, (mgr as DeptEmp).leave_end_date) && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatLeaveDateRange((mgr as DeptEmp).leave_start_date, (mgr as DeptEmp).leave_end_date)}
                </p>
              )}
            </div>
            <div className="text-sm text-muted-foreground whitespace-nowrap">
              עובדים במחלקה: <span className="font-semibold text-foreground">{total}</span>
            </div>
          </div>
        </Card>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            עובדי {data.dept.name}
          </h2>
          <Link to="/employees" className="text-sm text-primary hover:underline">
            לרשימה המלאה ←
          </Link>
        </div>
        {emps.length === 0 ? (
          <Card className="card-elevated p-6 text-sm text-muted-foreground">
            עדיין אין עובדים משויכים למחלקה זו.
          </Card>
        ) : (
          <div className={DASH_TILE_GRID}>
            {emps.map((e) => (
              <Card key={e.id} className={DASH_TILE}>
                <div className="flex h-full w-full items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent text-sm font-semibold text-accent-foreground">
                    <span>{e.full_name?.charAt(0) || "?"}</span>
                  </div>
                  <div className="min-w-0 flex-1 self-center">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{e.full_name || "ללא שם"}</p>
                      {!e.is_active && (
                        <Badge variant="destructive" className="rounded-full text-xs">לא פעיל</Badge>
                      )}
                      {isEmployeeCurrentlyOnLeave(e) && (
                        <Badge variant="secondary" className="rounded-full text-xs">בחופש</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function AdminDashboard({
  stats,
  loading,
  onSelectDept,
  canCreateEmployee,
  canViewDepartments,
  departmentManagerNames,
  currentUserRoles,
}: {
  stats?: { total: number; active: number; inactive: number; onLeave: number; onBreak: number; byDept: Record<string, number>; departments: DeptRow[] };
  loading: boolean;
  onSelectDept?: (id: string) => void;
  canCreateEmployee: boolean;
  canViewDepartments: boolean;
  departmentManagerNames?: Record<string, string | null>;
  currentUserRoles?: AppRole[];
}) {
  const navigate = useNavigate();
  const [createForDept, setCreateForDept] = useState<DeptRow | null>(null);
  const [deptsOpen, setDeptsOpen] = useState(false);
  if (loading || !stats) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  const deptCount = stats.departments.length;
  const staffInDepts = stats.departments.reduce(
    (n, d) => n + (stats.byDept[d.id] ?? 0),
    0,
  );

  return (
    <>
      <section>
        {deptCount === 0 ? (
          <Card className="card-elevated p-6 text-sm text-muted-foreground">
            עדיין לא הוגדרו מחלקות. ניתן להוסיף דרך מסך ניהול המחלקות.
          </Card>
        ) : (
          <Collapsible open={deptsOpen} onOpenChange={setDeptsOpen}>
            <Card className="card-elevated overflow-hidden">
              <div className="flex items-stretch gap-1 p-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-right outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className={`${DASH_TILE_ICON} bg-primary/15 text-primary`}>
                      <Building2 className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 self-center">
                      <h3 className={DASH_TILE_TITLE}>עובדים לפי מחלקה</h3>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {deptCount} מחלקות · {staffInDepts} עובדים
                      </p>
                    </div>
                    <div className={DASH_TILE_TRAIL}>
                      <ChevronDown
                        className={`size-4 text-muted-foreground transition-transform ${
                          deptsOpen ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </button>
                </CollapsibleTrigger>
                <Link
                  to="/employees"
                  className="shrink-0 self-center px-2 text-xs text-primary hover:underline"
                >
                  לכל העובדים
                </Link>
              </div>

              <CollapsibleContent>
                <ul className="max-h-[min(60vh,28rem)] divide-y overflow-y-auto border-t">
                  {stats.departments.map((d) => (
                    <li key={d.id}>
                      <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent/30">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-right outline-none"
                          onClick={() => onSelectDept?.(d.id)}
                        >
                          <p className="truncate text-base font-bold leading-snug">{d.name}</p>
                          {canViewDepartments && (
                            <p className="mt-0.5 truncate text-sm font-bold text-destructive">
                              אחראי: {departmentManagerNames?.[d.id] ?? "לא מונה"}
                            </p>
                          )}
                          <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                            {stats.byDept[d.id] ?? 0} עובדים
                          </p>
                        </button>
                        {canCreateEmployee && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 gap-1 px-2 text-xs"
                            onClick={() => setCreateForDept(d)}
                            title="הוסף עובד למחלקה"
                          >
                            <UserPlus className="size-3" />
                            הוסף
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}
      </section>

      {createForDept && (
        <CreateEmployeeDialog
          depts={stats.departments.map((x) => ({ id: x.id, name: x.name, code: "" }))}
          defaultDepartmentId={createForDept.id}
          lockDepartment
          onClose={() => setCreateForDept(null)}
          onViewExisting={() => {
            setCreateForDept(null);
            navigate({ to: "/employees", search: { filter: "all", dept: createForDept.id } as any });
          }}
          onEditExisting={() => {
            setCreateForDept(null);
            navigate({ to: "/employees", search: { filter: "all", dept: createForDept.id } as any });
          }}
          currentUserRoles={currentUserRoles}
          canEditJobTitle={isPlatformOwner(currentUserRoles ?? [])}
        />
      )}
    </>
  );
}

function EmployeeDashboard({ profile }: { profile: any }) {
  return (
    <div className="space-y-6">
      <BreakShortcutCard userId={profile.id} />
      <LeaveShortcutCard userId={profile.id} />
      <EmployeeNotificationsCard userId={profile.id} />
      <EmployeeNewMessagesCard userId={profile.id} />
    </div>
  );
}

function EmployeeNotificationsCard({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["emp-dash-notif", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("schedule_notifications")
        .select("id, message, created_at, read_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  const unread = items.filter((n: any) => !n.read_at);
  const notifSig = attentionSignatureFromIds(unread.map((n: any) => String(n.id)));
  const { needsAttention, markSeen } = useDashboardCardAttention(
    userId,
    "notifications-card",
    notifSig,
  );

  const openCard = () => {
    markSeen();
    navigate({ to: "/schedules" });
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openCard();
        }
      }}
      className={
        needsAttention
          ? `card-elevated p-4 cursor-pointer transition-all ${DASH_TILE_ATTENTION}`
          : "card-elevated p-4 cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30 transition-all"
      }
    >
      <div className="flex items-center justify-between mb-3">
        <h2
          className={
            needsAttention
              ? "font-semibold text-base flex items-center gap-2 text-destructive"
              : "font-semibold text-base flex items-center gap-2"
          }
        >
          <AlertTriangle className={`size-5 ${needsAttention ? "text-destructive" : "text-primary"}`} />
          התראות
          {unread.length > 0 && (
            <span
              className={
                needsAttention
                  ? "inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold shadow-md"
                  : "inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold"
              }
            >
              {unread.length > 99 ? "99+" : unread.length}
            </span>
          )}
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין התראות חדשות.</p>
      ) : (
        <ul className="divide-y">
          {items.map((n: any) => (
            <li key={n.id} className="py-2 text-sm">
              <p className={!n.read_at ? "font-medium" : ""}>{n.message}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(n.created_at).toLocaleString("he-IL")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EmployeeNewMessagesCard({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["emp-dash-msgs", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_recipients")
        .select("message_id, delivered_at, message:messages!inner(id, title, created_at, deleted_at)")
        .eq("user_id", userId)
        .is("read_at", null)
        .is("archived_at", null)
        .order("delivered_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return ((data ?? []) as any[]).filter((r) => !r.message?.deleted_at);
    },
  });
  const items = q.data ?? [];
  const count = items.length;
  const msgSig = attentionSignatureFromIds(
    items.map((r: any) => String(r.message_id)),
  );
  const { needsAttention, markSeen } = useDashboardCardAttention(
    userId,
    "messages-new",
    msgSig,
  );
  const navigate = useNavigate();
  const goInbox = () => {
    markSeen();
    navigate({ to: "/communications", search: { tab: "inbox" } as any });
  };
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={goInbox}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goInbox();
        }
      }}
      className={
        needsAttention
          ? `card-elevated overflow-hidden ${DASH_TILE_ATTENTION}`
          : "card-elevated overflow-hidden hover:bg-accent/30"
      }
    >
      <div className="flex items-stretch gap-1 p-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 text-right">
          <div
            className={
              needsAttention
                ? `${DASH_TILE_ICON} bg-destructive/20 text-destructive`
                : `${DASH_TILE_ICON} bg-primary/15 text-primary`
            }
          >
            <Send className="size-4" />
          </div>
          <div className="min-w-0 flex-1 self-center">
            <h3
              className={
                needsAttention
                  ? `${DASH_TILE_TITLE} text-destructive`
                  : DASH_TILE_TITLE
              }
            >
              הודעות חדשות
            </h3>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {count > 0
                ? `יש ${count} הודעות שלא נקראו`
                : "אין הודעות חדשות כרגע"}
            </p>
          </div>
          <div className={`${DASH_TILE_TRAIL} gap-1.5`}>
            {count > 0 ? (
              <Badge
                variant={needsAttention ? "destructive" : "secondary"}
                className="rounded-full px-2"
              >
                {count > 99 ? "99+" : count}
              </Badge>
            ) : null}
            <span className="text-xs text-primary">למרכז תקשורת</span>
          </div>
        </div>
      </div>
    </Card>
  );
}



function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
  badge,
  pulse,
  attention,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: "primary" | "success" | "muted" | "warning" | "danger";
  onClick?: () => void;
  badge?: number;
  pulse?: boolean;
  /** Red until opened — color only; does not change permissions. */
  attention?: boolean;
}) {
  const effectiveTone = attention ? "danger" : tone;
  // Attention cards always show a clear count badge (value), even if badge prop omitted.
  const badgeCount = badge != null ? badge : attention && value > 0 ? value : 0;
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    muted: "bg-muted text-muted-foreground",
    warning: "bg-orange-500/10 text-orange-600",
    danger: "bg-destructive/20 text-destructive",
  }[effectiveTone];
  const cardClass =
    effectiveTone === "danger"
      ? `${DASH_TILE} cursor-pointer bg-destructive/10 border-2 border-destructive ring-2 ring-destructive/40 hover:bg-destructive/15`
      : `${DASH_TILE} cursor-pointer hover:bg-accent/30`;
  const inner = (
    <Card className={cardClass + (pulse && !attention ? " animate-pulse" : "")}>
      <div className="flex h-full w-full items-center gap-2.5">
        <div className="min-w-0 flex-1 self-center text-right">
          <p
            className={
              effectiveTone === "danger"
                ? "line-clamp-2 text-sm font-semibold leading-tight text-destructive"
                : "line-clamp-2 text-sm font-semibold leading-tight"
            }
          >
            {label}
          </p>
          <p
            className={
              "mt-0.5 text-2xl font-bold tabular-nums leading-none " +
              (effectiveTone === "danger" ? "text-destructive" : "")
            }
          >
            {value}
          </p>
        </div>
        <div className={`relative ${DASH_TILE_ICON} ${toneClass}`}>
          <Icon className="size-4" />
          {badgeCount > 0 && (
            <span
              className={
                attention
                  ? "absolute -top-2 -right-2 flex h-6 min-w-[24px] items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground shadow-md ring-2 ring-background"
                  : "absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground shadow"
              }
            >
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
  if (!onClick) return inner;
  return (
    <button type="button" onClick={onClick} className="text-right w-full">
      {inner}
    </button>
  );
}

function DashboardSchedulePanel({ profile }: { profile: any }) {
  const needsLoadedPerms = scheduleScopeNeedsLoadedPermissions(profile.roles);

  const permsQ = useQuery({
    queryKey: ["my-perms", profile.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select(
          "can_view_schedule, can_create_schedule, can_edit_schedule, can_approve_schedule, can_publish_schedule, can_manage_schedule",
        )
        .eq("user_id", profile.id)
        .maybeSingle();
      return (
        data ?? {
          can_view_schedule: false,
          can_create_schedule: false,
          can_edit_schedule: false,
          can_approve_schedule: false,
          can_publish_schedule: false,
          can_manage_schedule: false,
        }
      );
    },
  });

  const permsReady = !needsLoadedPerms || !permsQ.isLoading;
  const scheduleCaps = useMemo(
    () => resolveScheduleManagerCaps(profile.roles, permsReady ? permsQ.data : undefined),
    [profile.roles, permsQ.data, permsReady],
  );
  const { isDeptHeadOnly } = scheduleCaps;

  const managedDeptQ = useQuery({
    enabled: permsReady && isDeptHeadOnly && !!profile?.id,
    queryKey: ["managed-dept-id", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id")
        .eq("manager_id", profile.id)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? profile.department_id ?? null;
    },
  });

  if (!permsReady || (isDeptHeadOnly && managedDeptQ.isLoading)) {
    return (
      <section className="space-y-4">
        <DashboardScheduleHeader />
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const scope = resolveDashboardScheduleScope({
    caps: scheduleCaps,
    departmentId: profile.department_id,
    managedDepartmentId: managedDeptQ.data,
  });

  if (scope.kind === "none") return null;

  const overview =
    scope.kind === "branch" ? (
      <DailyScheduleOverview scope="branch" selfUserId={profile.id} />
    ) : (
      <DailyScheduleOverview
        scope="department"
        departmentId={scope.departmentId}
        selfUserId={profile.id}
        useCoworkersView={scope.useCoworkersView}
      />
    );

  return (
    <section className="space-y-4">
      <DashboardScheduleHeader />
      {overview}
    </section>
  );
}

function DashboardScheduleHeader() {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <CalendarDays className="size-5 text-primary" />
        סידורי עבודה
      </h2>
      <Link to="/schedules" className="text-sm text-primary hover:underline">
        לסידורי העבודה ←
      </Link>
    </div>
  );
}

function SchedulesStatsSection({ profile }: { profile: any }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [approvedOpen, setApprovedOpen] = useState(false);
  const [notSubmittedOpen, setNotSubmittedOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [publishedOpen, setPublishedOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const publishAllFn = useServerFn(publishAllWeekSchedules);

  const permsQ = useQuery({
    queryKey: ["my-perms", profile.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select(
          "can_view_schedule, can_create_schedule, can_edit_schedule, can_approve_schedule, can_publish_schedule, can_manage_schedule",
        )
        .eq("user_id", profile.id)
        .maybeSingle();
      return (
        data ?? {
          can_view_schedule: false,
          can_create_schedule: false,
          can_edit_schedule: false,
          can_approve_schedule: false,
          can_publish_schedule: false,
          can_manage_schedule: false,
        }
      );
    },
  });

  const scheduleCaps = resolveScheduleManagerCaps(profile.roles, permsQ.data);
  const {
    isMainAdmin,
    isDeptMgr,
    isBranchMgr,
    canApprove,
    canPublishDirect,
  } = scheduleCaps;
  const canViewBranchScheduleOverview = isBranchMgr;
  const canManageOwnDeptSchedule = isDeptMgr;

  // Compute current week (Saturday-based) in Asia/Jerusalem-agnostic UTC slicing,
  // matching getWeekStart logic in schedules.tsx.
  const { weekStart, weekDays } = useMemo(() => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dowFromSat = (d.getUTCDay() + 1) % 7;
    d.setUTCDate(d.getUTCDate() - dowFromSat);
    const start = d.toISOString().slice(0, 10);
    const days = Array.from({ length: 7 }, (_, i) => {
      const x = new Date(d);
      x.setUTCDate(d.getUTCDate() + i);
      return x.toISOString().slice(0, 10);
    });
    return { weekStart: start, weekDays: days };
  }, []);
  const weekEnd = weekDays[6];

  const publishAllMut = useMutation({
    mutationFn: () => publishAllFn({ data: { week_start: weekStart } }),
    onSuccess: (res: any) => {
      if (res?.published > 0) {
        toast.success(`פורסמו ${res.published} סידורי עבודה`);
      } else {
        toast.info("אין סידורים לפרסום");
      }
      if (res?.errors?.length) {
        toast.warning(`לא פורסמו ${res.errors.length} סידורים`);
      }
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
      qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
      qc.invalidateQueries({ queryKey: ["dashboard-dept-states"] });
      setDraftOpen(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בפרסום"),
  });

  const scopeFilter = canViewBranchScheduleOverview ? null : profile.department_id ?? null;

  const statsQ = useQuery({
    enabled: !!profile && canViewBranchScheduleOverview,
    staleTime: 30_000,
    queryKey: [
      "dashboard-schedules",
      profile.id,
      weekStart,
      canApprove,
      canViewBranchScheduleOverview,
      canManageOwnDeptSchedule,
    ],
    queryFn: async () => {
      // Only current-week rows (+ all pending for approvers). Dept draft/published
      // tiles come from getWeekDepartmentStates — avoid shipping full schedule history
      // and unused schedule_shifts aggregates.
      const weekOrPending = canApprove
        ? `and(week_start.lte.${weekEnd},week_end.gte.${weekStart}),status.eq.pending_approval`
        : `and(week_start.lte.${weekEnd},week_end.gte.${weekStart})`;
      const { data: scheds, error: schedErr } = await supabase
        .from("schedules")
        .select("id, status, department_id, week_start, week_end, published_at, updated_at")
        .or(weekOrPending);
      if (schedErr) throw schedErr;

      const all = (scheds ?? []) as {
        id: string;
        status: string;
        department_id: string;
        week_start: string;
        week_end: string;
        published_at: string | null;
        updated_at: string | null;
      }[];

      const currentWeekScoped = all.filter(
        (s) => s.week_start <= weekEnd && weekStart <= s.week_end,
      );
      const pending = currentWeekScoped.filter((s) => s.status === "pending_approval").length;
      const approved = currentWeekScoped.filter((s) => s.status === "approved").length;

      const pendingAllList = (
        canApprove ? all.filter((s) => s.status === "pending_approval") : []
      ).sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

      const emptyDepts: { id: string; name: string }[] = [];
      return {
        pending,
        pendingAll: pendingAllList.length,
        pendingFirst: pendingAllList[0] ?? null,
        pendingIds: pendingAllList.map((s) => s.id),
        approved,
        noScheduleCount: 0,
        noScheduleDepts: emptyDepts,
        draftCount: 0,
        draftDepts: emptyDepts,
        publishedCount: 0,
        publishedDepts: emptyDepts,
      };
    },
  });

  // Authoritative dept state list (bypasses per-viewer RLS quirks): drafts and
  // published schedules always come from the service-role admin path so a
  // saved draft never leaks into "Departments without schedules".
  const getWeekDeptStatesFn = useServerFn(getWeekDepartmentStates);
  const deptStatesQ = useQuery({
    enabled: canViewBranchScheduleOverview,
    queryKey: ["dashboard-dept-states", weekStart, profile.id, canViewBranchScheduleOverview],
    queryFn: () => getWeekDeptStatesFn({ data: { week_start: weekStart } }),
  });

  // Hooks must run before any conditional return (loading / permission gate).
  const baseS = statsQ.data;
  const s = baseS
    ? deptStatesQ.data
      ? {
          ...baseS,
          noScheduleDepts: deptStatesQ.data.noSchedule,
          noScheduleCount: deptStatesQ.data.noSchedule.length,
          draftDepts: deptStatesQ.data.draft,
          draftCount: deptStatesQ.data.draft.length,
          publishedDepts: deptStatesQ.data.published,
          publishedCount: deptStatesQ.data.published.length,
        }
      : baseS
    : null;

  const pendingSchedSig =
    s && canApprove
      ? attentionSignatureFromIds((s as { pendingIds?: string[] }).pendingIds ?? [])
      : s && s.pending > 0
        ? `week:${weekStart}:n:${s.pending}`
        : "";
  const { needsAttention: pendingSchedAttention, markSeen: markPendingSchedSeen } =
    useDashboardCardAttention(profile.id, "schedules-pending", pendingSchedSig);

  const noSchedSig = attentionSignatureFromIds((s?.noScheduleDepts ?? []).map((d) => d.id));
  const draftSig = attentionSignatureFromIds((s?.draftDepts ?? []).map((d) => d.id));
  const publishedSig = attentionSignatureFromIds((s?.publishedDepts ?? []).map((d) => d.id));
  const approvedSig = s && s.approved > 0 ? `week:${weekStart}:n:${s.approved}` : "";
  const noSchedAttn = useDashboardCardAttention(profile.id, "schedules-no-schedule", noSchedSig);
  const draftAttn = useDashboardCardAttention(profile.id, "schedules-draft", draftSig);
  const publishedAttn = useDashboardCardAttention(profile.id, "schedules-published", publishedSig);
  const approvedAttn = useDashboardCardAttention(profile.id, "schedules-approved", approvedSig);

  const sectionSig = [pendingSchedSig, approvedSig, noSchedSig, draftSig, publishedSig]
    .filter(Boolean)
    .join("|");
  const sectionAttn = useDashboardCardAttention(
    profile.id,
    "schedules-status-section",
    sectionSig,
  );

  if (!canViewBranchScheduleOverview) return null;
  if (statsQ.isLoading || !s) return null;
  if (deptStatesQ.isLoading && !deptStatesQ.data) return null;

  const pendingValue = canApprove ? s.pendingAll : s.pending;
  const alertCount = pendingValue + s.noScheduleCount;
  const sectionNeedsAttention = sectionAttn.needsAttention;

  const goPending = () => {
    markPendingSchedSeen();
    // Approver shortcut: if exactly one pending schedule exists, open it directly
    // in the editor/approval view. Otherwise show the full pending list.
    if (canApprove && s.pendingAll === 1 && s.pendingFirst) {
      navigate({
        to: "/schedules",
        search: {
          view: "editor",
          dept: s.pendingFirst.department_id,
          week: s.pendingFirst.week_start,
        } as any,
      });
      return;
    }
    navigate({ to: "/schedules", search: { view: "pending" } as any });
  };

  return (
    <section className="space-y-4">
      <Collapsible
        open={schedulesOpen}
        onOpenChange={(open) => {
          setSchedulesOpen(open);
          if (open) sectionAttn.markSeen();
        }}
      >
        <Card
          className={
            sectionNeedsAttention && !schedulesOpen
              ? `card-elevated overflow-hidden ${DASH_TILE_ATTENTION}`
              : "card-elevated overflow-hidden"
          }
        >
          <div className="flex items-stretch gap-1 p-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-right outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className={
                    sectionNeedsAttention && !schedulesOpen
                      ? `${DASH_TILE_ICON} bg-destructive/20 text-destructive`
                      : `${DASH_TILE_ICON} bg-primary/15 text-primary`
                  }
                >
                  <CalendarDays className="size-4" />
                </div>
                <div className="min-w-0 flex-1 self-center">
                  <h3
                    className={
                      sectionNeedsAttention && !schedulesOpen
                        ? `${DASH_TILE_TITLE} text-destructive`
                        : DASH_TILE_TITLE
                    }
                  >
                    סטטוס סידורי עבודה
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {`${pendingValue} ממתינים · ${s.approved} מאושרים · ${s.noScheduleCount} ללא סידור · ${s.draftCount} שמורים · ${s.publishedCount} מפורסמים`}
                  </p>
                </div>
                <div className={`${DASH_TILE_TRAIL} gap-1.5`}>
                  {sectionNeedsAttention && !schedulesOpen ? (
                    <Badge variant="destructive" className="rounded-full px-2">
                      {Math.max(alertCount, 1)}
                    </Badge>
                  ) : null}
                  <ChevronDown
                    className={`size-4 text-muted-foreground transition-transform ${
                      schedulesOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
            <Link
              to="/schedules"
              className="shrink-0 self-center px-2 text-xs text-primary hover:underline"
              onClick={() => sectionAttn.markSeen()}
            >
              לסידורים
            </Link>
          </div>

          <CollapsibleContent>
            <div className={`border-t p-3 space-y-2`}>
              <div className={DASH_TILE_GRID}>
                <StatCard
                  label="ממתינים לאישור"
                  value={pendingValue}
                  icon={Clock}
                  tone="warning"
                  badge={pendingValue}
                  attention={pendingSchedAttention}
                  onClick={goPending}
                />
                <StatCard
                  label="מאושרים"
                  value={s.approved}
                  icon={CheckCircle2}
                  tone="success"
                  badge={s.approved}
                  attention={approvedAttn.needsAttention}
                  onClick={() => {
                    approvedAttn.markSeen();
                    setApprovedOpen(true);
                  }}
                />
              </div>
              <div className={DASH_TILE_GRID}>
                <StatCard
                  label="מחלקות שטרם הוכן להן סידור עבודה"
                  value={s.noScheduleCount}
                  icon={Building2}
                  tone="warning"
                  badge={s.noScheduleCount}
                  attention={noSchedAttn.needsAttention}
                  onClick={() => {
                    noSchedAttn.markSeen();
                    setNotSubmittedOpen(true);
                  }}
                />
                <StatCard
                  label="מחלקות עם סידור עבודה שמור"
                  value={s.draftCount}
                  icon={CalendarDays}
                  tone="primary"
                  badge={s.draftCount}
                  attention={draftAttn.needsAttention}
                  onClick={() => {
                    draftAttn.markSeen();
                    setDraftOpen(true);
                  }}
                />
                <StatCard
                  label="מחלקות עם סידור עבודה שפורסם"
                  value={s.publishedCount}
                  icon={CheckCircle2}
                  tone="success"
                  badge={s.publishedCount}
                  attention={publishedAttn.needsAttention}
                  onClick={() => {
                    publishedAttn.markSeen();
                    setPublishedOpen(true);
                  }}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <ApprovedSchedulesDialog
        open={approvedOpen}
        onOpenChange={setApprovedOpen}
        scopeFilter={scopeFilter}
      />

      <Dialog open={notSubmittedOpen} onOpenChange={setNotSubmittedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>מחלקות שטרם הוכן להן סידור עבודה</DialogTitle>
          </DialogHeader>
          {s.noScheduleDepts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              לכל המחלקות הוכן סידור עבודה לשבוע הנוכחי.
            </p>
          ) : (
            <ul className="divide-y max-h-[60vh] overflow-auto">
              {s.noScheduleDepts.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setNotSubmittedOpen(false);
                      navigate({
                        to: "/schedules",
                        search: { dept: d.id, week: weekStart, view: "editor" } as any,
                      });
                    }}
                    className="w-full text-right py-3 px-2 hover:bg-accent/30 rounded-md flex items-center gap-2"
                  >
                    <Building2 className="size-4 text-amber-600" />
                    <span className="font-medium">{d.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>מחלקות עם סידור עבודה שמור</DialogTitle>
          </DialogHeader>
          {s.draftDepts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              אין סידורי עבודה שמורים לשבוע הנוכחי.
            </p>
          ) : (
            <>
              <ul className="divide-y max-h-[50vh] overflow-auto">
                {s.draftDepts.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftOpen(false);
                        navigate({
                          to: "/schedules",
                          search: { dept: d.id, week: weekStart, view: "editor" } as any,
                        });
                      }}
                      className="w-full text-right py-3 px-2 hover:bg-accent/30 rounded-md flex items-center gap-2"
                    >
                      <CalendarDays className="size-4 text-primary" />
                      <span className="font-medium">{d.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {canPublishDirect && s.draftCount > 0 && (
                <div className="pt-4 border-t">
                  <Button
                    className="w-full"
                    onClick={() => publishAllMut.mutate()}
                    disabled={publishAllMut.isPending}
                  >
                    {publishAllMut.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    📤 פרסם את כל סידורי העבודה
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={publishedOpen} onOpenChange={setPublishedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>מחלקות עם סידור עבודה שפורסם</DialogTitle>
          </DialogHeader>
          {s.publishedDepts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              אין סידורי עבודה שפורסמו לשבוע הנוכחי.
            </p>
          ) : (
            <ul className="divide-y max-h-[60vh] overflow-auto">
              {s.publishedDepts.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPublishedOpen(false);
                      navigate({
                        to: "/schedules",
                        search: { dept: d.id, week: weekStart, view: "editor" } as any,
                      });
                    }}
                    className="w-full text-right py-3 px-2 hover:bg-accent/30 rounded-md flex items-center gap-2"
                  >
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span className="font-medium">{d.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

    </section>
  );
}

function ApprovedSchedulesDialog({
  open,
  onOpenChange,
  scopeFilter,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scopeFilter: string | null;
}) {
  const navigate = useNavigate();
  const q = useQuery({
    enabled: open,
    queryKey: ["dashboard-approved-list", scopeFilter],
    queryFn: async () => {
      let sq = supabase
        .from("schedules")
        .select(
          "id, department_id, week_start, week_end, created_by, approved_by, approved_at, published_at",
        )
        .eq("status", "approved")
        .order("week_start", { ascending: false });
      if (scopeFilter) sq = sq.eq("department_id", scopeFilter);
      const { data: scheds } = await sq;
      const rows = (scheds ?? []) as any[];
      if (!rows.length) return [];
      const deptIds = Array.from(new Set(rows.map((r) => r.department_id).filter(Boolean)));
      const peopleIds = Array.from(
        new Set(rows.flatMap((r) => [r.created_by, r.approved_by]).filter(Boolean)),
      );
      const [deptsRes, peopleRes] = await Promise.all([
        deptIds.length
          ? supabase.from("departments").select("id, name").in("id", deptIds)
          : Promise.resolve({ data: [] as any[] }),
        peopleIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", peopleIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const dm: Record<string, string> = {};
      (deptsRes.data ?? []).forEach((d: any) => (dm[d.id] = d.name));
      const pm: Record<string, string> = {};
      (peopleRes.data ?? []).forEach((p: any) => (pm[p.id] = p.full_name));
      return rows.map((r) => ({
        ...r,
        department_name: dm[r.department_id] ?? "—",
        creator_name: pm[r.created_by] ?? "—",
        approver_name: pm[r.approved_by] ?? "—",
      }));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>סידורי עבודה מאושרים</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            אין סידורי עבודה מאושרים.
          </p>
        ) : (
          <ul className="divide-y max-h-[60vh] overflow-auto">
            {q.data.map((r: any) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    navigate({
                      to: "/schedules",
                      search: { dept: r.department_id, week: r.week_start, view: "editor" } as any,
                    });
                  }}
                  className="w-full text-right py-3 px-2 hover:bg-accent/30 rounded-md"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-primary hover:underline">{r.department_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("he-IL", {
                        timeZone: "Asia/Jerusalem",
                        dateStyle: "short",
                        numberingSystem: "latn",
                        calendar: "gregory",
                      }).format(new Date(r.week_start + "T00:00:00Z"))}{" "}
                      –{" "}
                      {new Intl.DateTimeFormat("he-IL", {
                        timeZone: "Asia/Jerusalem",
                        dateStyle: "short",
                        numberingSystem: "latn",
                        calendar: "gregory",
                      }).format(new Date(r.week_end + "T00:00:00Z"))}
                    </p>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span>נוצר ע״י: <span className="text-foreground">{r.creator_name}</span></span>
                    <span>אושר ע״י: <span className="text-foreground">{r.approver_name}</span></span>
                    <span>
                      תאריך אישור:{" "}
                      <span className="text-foreground">
                        {r.approved_at
                          ? new Intl.DateTimeFormat("he-IL", {
                              timeZone: "Asia/Jerusalem",
                              dateStyle: "short",
                              timeStyle: "short",
                              numberingSystem: "latn",
                              calendar: "gregory",
                            }).format(new Date(r.approved_at))
                          : "—"}
                      </span>
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DepartmentEmployeesDialog({
  deptId,
  onClose,
  onSelectEmployee,
}: {
  deptId: string | null;
  onClose: () => void;
  onSelectEmployee: (id: string) => void;
}) {
  const open = deptId !== null;
  const q = useQuery({
    enabled: open && !!deptId,
    queryKey: ["dept-employees-dialog", deptId],
    queryFn: async () => {
      if (!deptId) return null;
      const { data: dept, error: dErr } = await supabase
        .from("departments")
        .select("id, name, manager_id")
        .eq("id", deptId)
        .single();
      if (dErr) throw dErr;
      const { data: emps, error: eErr } = await supabase
        .from("profiles")
        .select("id, full_name, is_active, on_leave, leave_start_date, leave_end_date, avatar_url, department_id")
        .eq("department_id", deptId)
        .order("full_name");
      if (eErr) throw eErr;
      const empIds = (emps ?? []).map((e: any) => e.id);
      const [{ data: roles }, { data: manager }] = await Promise.all([
        empIds.length
          ? supabase.from("user_roles").select("user_id, role").in("user_id", empIds)
          : Promise.resolve({ data: [] as any[] }),
        dept.manager_id
          ? supabase.from("profiles").select("full_name").eq("id", dept.manager_id).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      const roleMap: Record<string, string> = {};
      (roles ?? []).forEach((r: any) => {
        roleMap[r.user_id] = ROLE_LABELS[r.role as AppRole] ?? r.role;
      });
      return {
        deptName: dept.name,
        managerName: manager?.full_name ?? null,
        managerId: dept.manager_id,
        employees: (emps ?? []).map((e: any) => ({
          ...e,
          roleLabel: roleMap[e.id] ?? "עובד",
          isManager: e.id === dept.manager_id,
        })),
      };
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>עובדי {q.data?.deptName ?? "—"}</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !q.data || q.data.employees.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">אין עובדים במחלקה זו.</p>
        ) : (
          <ul className="divide-y max-h-[60vh] overflow-auto">
            {q.data.employees.map((emp: any) => (
              <li key={emp.id}>
                <button
                  type="button"
                  onClick={() => onSelectEmployee(emp.id)}
                  className="w-full text-right py-3 px-2 hover:bg-accent/30 rounded-md"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{emp.full_name || "ללא שם"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {emp.roleLabel}
                        {emp.isManager && (
                          <span className="text-primary font-semibold mr-1">· אחראי מחלקה</span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!emp.is_active && (
                        <Badge variant="destructive" className="rounded-full text-xs">לא פעיל</Badge>
                      )}
                      {isEmployeeCurrentlyOnLeave(emp) && (
                        <Badge variant="secondary" className="rounded-full text-xs">בחופש</Badge>
                      )}
                      {emp.is_active && !isEmployeeCurrentlyOnLeave(emp) && (
                        <Badge variant="outline" className="rounded-full text-xs">פעיל</Badge>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmployeeProfileDialog({
  employeeId,
  onClose,
}: {
  employeeId: string | null;
  onClose: () => void;
}) {
  const open = employeeId !== null;
  const q = useQuery({
    enabled: open && !!employeeId,
    queryKey: ["employee-profile-dialog", employeeId],
    queryFn: async () => {
      if (!employeeId) return null;
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, department_id, job_title, is_active, on_leave, leave_start_date, leave_end_date, avatar_url, departments(name)")
        .eq("id", employeeId)
        .maybeSingle();
      if (pErr) throw pErr;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", employeeId);
      const roleLabel = (roles ?? []).map((r: any) => ROLE_LABELS[r.role as AppRole]).filter(Boolean).join(", ") || "—";
      const { data: contactRows } = await supabase.rpc("get_profile_contact", { _id: employeeId });
      const contact: any = Array.isArray(contactRows) ? contactRows[0] ?? {} : contactRows ?? {};
      let avatarUrl: string | null = null;
      if (profile?.avatar_url) {
        const { data: urlData } = await supabase.storage.from("avatars").createSignedUrl(profile.avatar_url, 60 * 60);
        avatarUrl = urlData?.signedUrl ?? null;
      }
      return {
        ...profile,
        id_number: contact.id_number ?? null,
        phone: contact.phone ?? null,
        departmentName: (profile as any)?.departments?.name ?? "—",
        roleLabel,
        avatarUrl,
      };
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>פרטי עובד</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !q.data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">לא נמצאו פרטי עובד.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="size-16 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xl font-bold shrink-0 overflow-hidden">
                {q.data.avatarUrl ? (
                  <img src={q.data.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="size-7" />
                )}
              </div>
              <div>
                <p className="font-semibold text-lg">{q.data.full_name || "ללא שם"}</p>
                <p className="text-sm text-muted-foreground">{q.data.roleLabel}</p>
              </div>
            </div>
            <Card className="p-4 space-y-3">
              <ProfileRow label="מספר זהות" value={q.data.id_number ?? "—"} />
              <ProfileRow label="מחלקה" value={q.data.departmentName} />
              <ProfileRow label="טלפון" value={q.data.phone ?? "—"} />
              <ProfileRow
                label="סטטוס"
                value={
                  isEmployeeCurrentlyOnLeave(q.data)
                    ? `בחופש${formatLeaveDateRange(q.data.leave_start_date, q.data.leave_end_date) ? ` (${formatLeaveDateRange(q.data.leave_start_date, q.data.leave_end_date)})` : ""}`
                    : q.data.is_active
                    ? "פעיל"
                    : "לא פעיל"
                }
              />
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function fmtHM(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtMinsHM(totalMins: number) {
  const m = Math.max(0, Math.floor(totalMins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}:${String(r).padStart(2, "0")}` : `${r} דק׳`;
}

function fmtHMS(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function MyActiveBreakCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [, setTick] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);

  const breakQ = useQuery({
    enabled: !!userId,
    queryKey: ["my-active-break", userId],
    staleTime: 15_000,
    queryFn: async () => {
      const { primary } = await fetchMyBreakDashboardRows(userId);
      return primary;
    },
  });

  const activeRow = breakQ.data;
  useActivateDueBreaksPoll(userId, qc, {
    plannedStartIso: activeRow ? breakStartIso(activeRow) : null,
    isActive: activeRow?.status === "active",
  });

  useEffect(() => {
    // Only tick while a live countdown is on screen.
    if (!activeRow) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeRow?.id]);

  const endMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("end_my_break", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("סומן: חזרת מההפסקה");
      setDetailOpen(false);
      qc.invalidateQueries({ queryKey: ["my-active-break", userId] });
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const r = breakQ.data;
  if (!r) return null;

  const now = Date.now();
  const isActive = r.status === "active";
  const isPreActive = (BREAK_PRE_ACTIVE_STATUSES as readonly string[]).includes(r.status);
  const startsAtIso: string | null = breakStartIso(r);
  const endsAtMs = r.ends_at
    ? new Date(r.ends_at).getTime()
    : startsAtIso
      ? new Date(startsAtIso).getTime() + (r.duration_minutes ?? 0) * 60000
      : null;
  const remainingMs = endsAtMs ? endsAtMs - now : 0;
  const overrunMs = endsAtMs && now > endsAtMs ? now - endsAtMs : 0;
  const overrun = isActive && overrunMs > 0;

  const tone = overrun
    ? {
        card: "border-red-500 bg-red-50 dark:bg-red-950/30",
        icon: "bg-red-500/10 text-red-600",
        timer: "text-red-600",
        label: "🔴 חריגה",
      }
    : isActive
      ? {
          card: "border-green-500 bg-green-50 dark:bg-green-950/30",
          icon: "bg-green-500/10 text-green-600",
          timer: "text-green-600",
          label: "🟢 בהפסקה",
        }
      : {
          card: "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
          icon: "bg-amber-500/10 text-amber-600",
          timer: "text-amber-600",
          label: "🟡 אושרה · ממתינה להתחלה",
        };

  const bigTimer = overrun
    ? `+${fmtHMS(overrunMs)}`
    : isActive && endsAtMs
      ? fmtHMS(remainingMs)
      : isPreActive && startsAtIso
        ? fmtHMS(Math.max(0, new Date(startsAtIso).getTime() - now))
        : endsAtMs
          ? fmtHMS(Math.max(0, endsAtMs - now))
          : "--:--";

  const actualDurMin =
    r.completed_at && startsAtIso
      ? Math.max(
          0,
          Math.round(
            (new Date(r.completed_at).getTime() - new Date(startsAtIso).getTime()) / 60000,
          ),
        )
      : null;

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setDetailOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setDetailOpen(true);
        }}
        className={
          "card-elevated p-5 border-2 cursor-pointer transition-colors hover:brightness-[0.98] " +
          tone.card
        }
      >
        <div className="flex items-start gap-3">
          <div className={"size-10 rounded-xl flex items-center justify-center shrink-0 " + tone.icon}>
            <Coffee className="size-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">ההפסקה שלי</h3>
              <Badge variant={overrun ? "destructive" : isActive ? "default" : "secondary"}>
                {tone.label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                ☕ {r.setting_name} · {r.duration_minutes} דק׳
              </span>
            </div>

            <div className="flex flex-col items-center justify-center py-2 select-none">
              <div className={"font-mono font-bold tabular-nums text-5xl sm:text-6xl tracking-wider " + tone.timer}>
                {bigTimer}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {overrun
                  ? "זמן חריגה — נא לחזור לעבודה"
                    : isActive
                      ? "זמן נותר להפסקה"
                      : startsAtIso
                        ? `תתחיל ב־${fmtHM(startsAtIso)}`
                        : "הפסקה מאושרת — תתחיל בקרוב"}
              </div>
            </div>

            {(r as any).approver && (
              <div className="rounded-md border border-border/60 bg-background/50 p-2.5 text-xs space-y-0.5">
                <div className="font-medium text-foreground">✅ אושרה ע״י</div>
                <div className="text-muted-foreground">
                  👤 <span className="text-foreground font-medium">{(r as any).approver.full_name}</span>
                  {(r as any).approver.role_label && <span> · 💼 {(r as any).approver.role_label}</span>}
                  {(r as any).approver.job_title && <span> ({(r as any).approver.job_title})</span>}
                </div>
                {r.approval_decided_at && (
                  <div className="text-muted-foreground">
                    📅 <span className="text-foreground font-medium">{formatHeDateTime(r.approval_decided_at)}</span>
                  </div>
                )}
              </div>
            )}



            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {startsAtIso && (
                <div>▶️ התחלה: <span className="text-foreground font-medium">{fmtHM(startsAtIso)}</span></div>
              )}
              {endsAtMs && (
                <div>🏁 סיום מתוכנן: <span className="text-foreground font-medium">{fmtHM(new Date(endsAtMs).toISOString())}</span></div>
              )}
              {endsAtMs && (
                <div>🕒 חזרה משוערת: <span className="text-foreground">{fmtHM(new Date(endsAtMs).toISOString())}</span></div>
              )}
            </div>


            {isActive && (
              <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  className="gap-2"
                  variant={overrun ? "destructive" : "default"}
                  onClick={() => endMut.mutate(r.id)}
                  disabled={endMut.isPending}
                >
                  {endMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  ✅ חזרתי מהפסקה
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="size-5 text-primary" />
              פרטי ההפסקה שלי
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <DetailRow k="☕ סוג הפסקה" v={r.setting_name} />
            <DetailRow k="⏱️ משך מאושר" v={`${r.duration_minutes} דק׳`} />
            <DetailRow k="▶️ שעת תחילת הפסקה" v={startsAtIso ? formatHeDateTime(startsAtIso) : "—"} />
            <DetailRow
              k="🏁 שעת סיום מתוכננת"
              v={endsAtMs ? formatHeDateTime(new Date(endsAtMs).toISOString()) : "—"}
            />
            <DetailRow
              k="🕒 שעת חזרה בפועל"
              v={r.completed_at ? formatHeDateTime(r.completed_at) : "— (בהפסקה)"}
            />
            <DetailRow
              k="⏳ משך הפסקה בפועל"
              v={actualDurMin != null ? `${actualDurMin} דק׳` : "—"}
            />
            <DetailRow
              k="🔴 זמן חריגה"
              v={
                overrun
                  ? fmtHMS(overrunMs)
                  : actualDurMin != null && r.duration_minutes && actualDurMin > r.duration_minutes
                    ? `${actualDurMin - r.duration_minutes} דק׳`
                    : "אין"
              }
            />
            {(r as any).approver && (
              <>
                <DetailRow k="👤 שם המאשר" v={(r as any).approver.full_name} />
                {(r as any).approver.role_label && (
                  <DetailRow k="💼 תפקיד המאשר" v={(r as any).approver.role_label} />
                )}
                {r.approval_decided_at && (
                  <DetailRow k="📅 תאריך ושעת אישור" v={formatHeDateTime(r.approval_decided_at)} />
                )}
              </>
            )}
          </div>


          {isActive && (
            <div className="pt-2">
              <Button
                className="gap-2 w-full"
                variant={overrun ? "destructive" : "default"}
                onClick={() => endMut.mutate(r.id)}
                disabled={endMut.isPending}
              >
                {endMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                ✅ חזרתי מהפסקה
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground font-medium text-right">{v}</span>
    </div>
  );
}

const MY_BREAK_SELECT =
  "id, status, break_setting_id, requested_at, planned_start, approved_at_time, approval_decided_at, started_at, ends_at, duration_minutes, approved_by";

async function fetchMyBreakDashboardRows(userId: string) {
  const { data, error } = await supabase
    .from("break_requests")
    .select(MY_BREAK_SELECT)
    .eq("user_id", userId)
    .in("status", [...BREAK_PRE_ACTIVE_STATUSES, "active", "pending_approval"])
    .order("requested_at", { ascending: true });
  if (error) return { primary: null, next: null, all: [] as any[] };
  const rows = (data ?? []) as any[];
  if (!rows.length) return { primary: null, next: null, all: [] as any[] };

  const settingIds = Array.from(
    new Set(rows.map((r) => r.break_setting_id).filter(Boolean)),
  ) as string[];
  const approverIds = Array.from(
    new Set(rows.map((r) => r.approved_by).filter(Boolean)),
  ) as string[];

  const [settingsRes, approversRes] = await Promise.all([
    settingIds.length
      ? supabase.from("break_settings").select("id, name").in("id", settingIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    approverIds.length
      ? (supabase as any).rpc("get_profiles_basic_info", { user_ids: approverIds })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const settingNameById = new Map(
    ((settingsRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  const approverById = new Map<
    string,
    { full_name: string; role_label: string | null; job_title: string | null }
  >();
  for (const rec of (approversRes.data ?? []) as any[]) {
    if (rec?.id) {
      approverById.set(rec.id, {
        full_name: rec.full_name,
        role_label: rec.role_label,
        job_title: rec.job_title,
      });
    }
  }

  const enriched = rows.map((row) => ({
    ...row,
    setting_name: settingNameById.get(row.break_setting_id) ?? "הפסקה",
    approver: row.approved_by ? approverById.get(row.approved_by) ?? null : null,
  }));

  const primary = pickPrimaryBreak(enriched);
  const active = pickActiveBreak(enriched);
  const next = active ? pickUpcomingBreak(enriched, active.id) : pickUpcomingBreak(enriched);
  return { primary, next, active, all: enriched };
}

type DashboardBreakRow = Awaited<ReturnType<typeof fetchMyBreakDashboardRows>>["all"][number];

function getBreakStartIso(row: DashboardBreakRow) {
  return row.started_at ?? row.planned_start ?? row.approved_at_time ?? row.requested_at ?? null;
}

function getBreakEndsAtMs(row: DashboardBreakRow, startsAtIso: string | null) {
  if (row.ends_at) return new Date(row.ends_at).getTime();
  if (startsAtIso) return new Date(startsAtIso).getTime() + (row.duration_minutes ?? 0) * 60000;
  return null;
}

function DashboardActiveBreakCard({
  row,
  onEnd,
  ending,
}: {
  row: DashboardBreakRow;
  onEnd: () => void;
  ending: boolean;
}) {
  const now = Date.now();
  const startsAtIso = getBreakStartIso(row);
  const endsAtMs = getBreakEndsAtMs(row, startsAtIso);
  const remainingMs = endsAtMs ? endsAtMs - now : 0;
  const overrunMs = endsAtMs && now > endsAtMs ? now - endsAtMs : 0;
  const overrun = overrunMs > 0;
  const bigTimer = overrun ? `+${fmtHMS(overrunMs)}` : endsAtMs ? fmtHMS(remainingMs) : "--:--";
  const tone = overrun
    ? { card: "border-red-500 bg-red-50 dark:bg-red-950/30", icon: "bg-red-500/10 text-red-600", timer: "text-red-600", label: "🔴 חריגה" }
    : { card: "border-green-500 bg-green-50 dark:bg-green-950/30", icon: "bg-green-500/10 text-green-600", timer: "text-green-600", label: "🟢 בהפסקה" };

  return (
    <Card className={"card-elevated p-5 border-2 " + tone.card}>
      <div className="flex items-start gap-3">
        <div className={"size-11 rounded-xl flex items-center justify-center shrink-0 " + tone.icon}>
          <Coffee className="size-6" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">הפסקה נוכחית</h3>
            <Badge variant={overrun ? "destructive" : "default"}>{tone.label}</Badge>
            <span className="text-sm text-muted-foreground">
              ☕ {row.setting_name} · {row.duration_minutes} דק׳
            </span>
          </div>
          <div className="flex flex-col items-center justify-center py-1 select-none">
            <div className={"font-mono font-bold tabular-nums text-4xl sm:text-5xl tracking-wider " + tone.timer}>
              {bigTimer}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {overrun ? "זמן חריגה — נא לחזור לעבודה" : "זמן נותר להפסקה"}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {startsAtIso && (
              <div>▶️ התחלה: <span className="text-foreground font-medium">{fmtHM(startsAtIso)}</span></div>
            )}
            {endsAtMs && (
              <div>🏁 סיום מתוכנן: <span className="text-foreground font-medium">{fmtHM(new Date(endsAtMs).toISOString())}</span></div>
            )}
          </div>
          <Button
            size="sm"
            className="gap-2 w-full sm:w-auto"
            variant={overrun ? "destructive" : "default"}
            onClick={onEnd}
            disabled={ending}
          >
            {ending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            סיום הפסקה
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DashboardUpcomingBreakCard({ row }: { row: DashboardBreakRow }) {
  const now = Date.now();
  const startsAtIso = getBreakStartIso(row);
  const startsMs = startsAtIso ? new Date(startsAtIso).getTime() : null;
  const countdownMs = startsMs ? Math.max(0, startsMs - now) : 0;
  const endsAtMs = getBreakEndsAtMs(row, startsAtIso);

  return (
    <Card className="card-elevated p-5 border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <div className="size-11 rounded-xl flex items-center justify-center shrink-0 bg-amber-500/10 text-amber-600">
          <Clock className="size-6" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">הפסקה הבאה</h3>
            <Badge variant="secondary">{BREAK_STATUS_LABEL[row.status] ?? row.status}</Badge>
            <span className="text-sm text-muted-foreground">
              ☕ {row.setting_name} · {row.duration_minutes} דק׳
            </span>
          </div>
          <div className="flex flex-col items-center justify-center py-1 select-none">
            <div className="font-mono font-bold tabular-nums text-4xl sm:text-5xl tracking-wider text-amber-600">
              {startsMs ? fmtHMS(countdownMs) : "--:--"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">זמן עד תחילת ההפסקה</div>
            {startsAtIso && (
              <div className="mt-2 text-base font-semibold text-amber-900 dark:text-amber-100 tabular-nums">
                תתחיל ב־{fmtHM(startsAtIso)}
                {endsAtMs
                  ? ` · עד ${fmtHM(new Date(endsAtMs).toISOString())}`
                  : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DashboardPendingBreakCard({ row }: { row: DashboardBreakRow }) {
  return (
    <Card className="card-elevated p-5 border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <div className="size-11 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
          <Clock className="size-6" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">הפסקה</h3>
            <Badge variant="secondary">🟡 ממתינה לאישור</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            ☕ {row.setting_name} · {row.duration_minutes} דק׳ · שעה מבוקשת{" "}
            {row.requested_at ? fmtHM(row.requested_at) : "—"}
          </p>
        </div>
      </div>
    </Card>
  );
}

function LeaveShortcutCard({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const leaveAccess = useLeaveAccess();
  // Key cards off live roles so a role change refreshes which cards appear
  const rolesKey = leaveAccess.roles.join(",");

  const myLeaveQ = useQuery({
    enabled: !!userId && leaveAccess.showRequestCard,
    queryKey: ["dashboard-my-leave", userId, rolesKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_requests")
        .select(
          `id, status, kind, start_date, end_date, days_count, admin_note, dept_note,
           admin_decided_at, dept_decided_at, admin_decider_name, dept_decider_name,
           leave_types(name),
           admin_decider:profiles!admin_decided_by(full_name, first_name, last_name),
           dept_decider:profiles!dept_decided_by(full_name, first_name, last_name)`,
        )
        .eq("user_id", userId)
        .in("status", ["pending_dept", "pending_admin", "approved", "rejected", "cancelled"])
        .order("submitted_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
    retry: false,
  });

  const pendingQueueQ = useQuery({
    enabled: !!userId && leaveAccess.showPendingQueueCard,
    queryKey: [
      "dashboard-leave-queue",
      userId,
      rolesKey,
      leaveAccess.pendingQueueMode,
    ],
    queryFn: async () => {
      let q = (supabase as any)
        .from("leave_requests")
        .select("id");
      if (leaveAccess.pendingQueueMode === "dept") {
        q = q.eq("status", "pending_dept");
      } else if (leaveAccess.pendingQueueMode === "both") {
        q = q.in("status", ["pending_dept", "pending_admin"]);
      } else {
        q = q.eq("status", "pending_admin");
      }
      const { data, error } = await q;
      if (error) throw error;
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      return {
        count: ids.length,
        signature: attentionSignatureFromIds(ids),
      };
    },
    staleTime: 30_000,
    retry: false,
  });

  const myRows = myLeaveQ.data ?? [];
  const pendingMine = myRows.filter(
    (r: any) => r.status === "pending_dept" || r.status === "pending_admin",
  );
  const approvedUpcoming = myRows.filter((r: any) => r.status === "approved");
  const newest = myRows[0] as any | undefined;
  const decisionBanner =
    newest && (newest.status === "rejected" || newest.status === "cancelled")
      ? leaveDecisionMessage(newest)
      : null;
  const queueCount = pendingQueueQ.data?.count ?? 0;
  const leaveQueueSig = pendingQueueQ.data?.signature ?? "";
  const { needsAttention: leaveQueueAttention, markSeen: markLeaveQueueSeen } =
    useDashboardCardAttention(userId, "leave-pending-queue", leaveQueueSig);

  const leaveMineSig =
    pendingMine.length > 0
      ? attentionSignatureFromIds(pendingMine.map((r: any) => String(r.id)))
      : decisionBanner && newest
        ? `decision:${newest.id}:${newest.status}`
        : approvedUpcoming.length > 0
          ? attentionSignatureFromIds(approvedUpcoming.map((r: any) => String(r.id)))
          : "";
  const { needsAttention: leaveMineAttention, markSeen: markLeaveMineSeen } =
    useDashboardCardAttention(userId, "leave-my-requests", leaveMineSig);

  const goLeaves = () => {
    markLeaveMineSeen();
    navigate({ to: "/leaves" });
  };
  const goAdmin = () => {
    markLeaveQueueSeen();
    navigate({ to: "/leaves-admin" });
  };

  const queueTitle = leaveAccess.isDeptManager && leaveAccess.pendingQueueMode === "dept"
    ? "בקשות חופשה במחלקה"
    : leaveAccess.isDeptManager
      ? "בקשות חופשה ממתינות"
      : "בקשות חופשה ממתינות לאישור";

  const queueSubtitle =
    leaveAccess.pendingQueueMode === "dept"
      ? queueCount > 0
        ? `${queueCount} בקשות ממתינות במחלקה`
        : "אין בקשות ממתינות במחלקה"
      : queueCount > 0
        ? `${queueCount} בקשות ממתינות לאישור`
        : "אין בקשות ממתינות לאישור";

  if (!leaveAccess.showRequestCard && !leaveAccess.showPendingQueueCard) {
    return null;
  }

  const both = leaveAccess.showRequestCard && leaveAccess.showPendingQueueCard;

  return (
    <div className={both ? DASH_TILE_GRID : "space-y-2"}>
      {leaveAccess.showPendingQueueCard && (
        <Card
          role="button"
          tabIndex={0}
          onClick={goAdmin}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") goAdmin();
          }}
          className={
            leaveQueueAttention
              ? `${DASH_TILE} cursor-pointer ${DASH_TILE_ATTENTION}`
              : `${DASH_TILE} cursor-pointer border border-amber-300/60 bg-amber-50/70 hover:bg-amber-50`
          }
        >
          <div className="flex h-full w-full items-center gap-2.5">
            <div
              className={
                leaveQueueAttention
                  ? `${DASH_TILE_ICON} bg-destructive/20 text-destructive`
                  : `${DASH_TILE_ICON} bg-amber-200/70 text-amber-900`
              }
            >
              <Palmtree className="size-4" />
            </div>
            <div className="min-w-0 flex-1 self-center">
              <h3
                className={
                  leaveQueueAttention
                    ? `${DASH_TILE_TITLE} text-destructive`
                    : DASH_TILE_TITLE
                }
              >
                {queueTitle}
              </h3>
              <p className={DASH_TILE_SUB}>{queueSubtitle}</p>
            </div>
            <div className={DASH_TILE_TRAIL}>
              <Badge
                className={
                  leaveQueueAttention
                    ? "bg-destructive px-1.5 py-0 text-xs font-bold text-destructive-foreground hover:bg-destructive shadow-md"
                    : "bg-amber-600 px-1.5 py-0 text-xs text-white hover:bg-amber-600"
                }
              >
                {queueCount}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {leaveAccess.showRequestCard && (
        <Card
          role="button"
          tabIndex={0}
          onClick={goLeaves}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") goLeaves();
          }}
          className={
            leaveMineAttention
              ? `${DASH_TILE} cursor-pointer ${DASH_TILE_ATTENTION}`
              : `${DASH_TILE} cursor-pointer border ${
                  decisionBanner && pendingMine.length === 0
                    ? decisionBanner.tone === "rejected"
                      ? "border-rose-300/70 bg-rose-50/70 hover:bg-rose-50"
                      : decisionBanner.tone === "cancelled"
                        ? "border-amber-300/70 bg-amber-50/70 hover:bg-amber-50"
                        : "border-emerald-300/50 bg-emerald-50/50 hover:bg-emerald-50"
                    : "border-emerald-300/50 bg-emerald-50/50 hover:bg-emerald-50"
                }`
          }
        >
          <div className="flex h-full w-full items-center gap-2.5">
            <div
              className={
                leaveMineAttention
                  ? `${DASH_TILE_ICON} bg-destructive/20 text-destructive`
                  : `${DASH_TILE_ICON} bg-emerald-200/60 text-emerald-900`
              }
            >
              <Palmtree className="size-4" />
            </div>
            <div className="min-w-0 flex-1 self-center">
              <h3
                className={
                  leaveMineAttention
                    ? `${DASH_TILE_TITLE} text-destructive`
                    : DASH_TILE_TITLE
                }
              >
                בקשת חופשה
              </h3>
              <p className={DASH_TILE_SUB}>
                {pendingMine.length > 0
                  ? `${pendingMine.length} בקשות ממתינות`
                  : decisionBanner
                    ? decisionBanner.text
                    : approvedUpcoming.length > 0
                      ? `${formatLeaveDateRange(approvedUpcoming[0].start_date, approvedUpcoming[0].end_date)}`
                      : "הגשה ומעקב סטטוס"}
              </p>
            </div>
            <div className={`${DASH_TILE_TRAIL} w-auto min-w-[4.75rem] gap-1.5`}>
              {(leaveMineAttention || pendingMine.length > 0) && (
                <Badge
                  className={
                    leaveMineAttention
                      ? "bg-destructive px-1.5 py-0 text-xs font-bold text-destructive-foreground hover:bg-destructive"
                      : "bg-emerald-700 px-1.5 py-0 text-xs text-white hover:bg-emerald-700"
                  }
                >
                  {pendingMine.length > 0
                    ? pendingMine.length
                    : leaveMineAttention
                      ? "!"
                      : 0}
                </Badge>
              )}
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  goLeaves();
                }}
              >
                <Send className="size-3" />
                בקשה
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function BreakShortcutCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [, setTick] = useState(0);
  const shiftGate = useShiftSelfServiceVisible();

  const canRequestQ = useQuery({
    enabled: !!userId,
    queryKey: ["can-request-break", userId],
    queryFn: () => fetchCanUserRequestBreak(userId),
    staleTime: 30_000,
    retry: false,
  });
  const canRequestBreak = canRequestQ.data === true;

  const breakQ = useQuery({
    enabled: !!userId,
    queryKey: ["my-break-shortcut", userId],
    staleTime: 15_000,
    queryFn: () => fetchMyBreakDashboardRows(userId),
  });

  const allRows = breakQ.data?.all ?? [];
  const activeBreak = pickActiveBreak(allRows);
  const upcomingBreaks = allRows.filter(
    (row) =>
      row.id !== activeBreak?.id &&
      (BREAK_PRE_ACTIVE_STATUSES as readonly string[]).includes(row.status),
  );
  const pendingBreaks = allRows.filter((row) =>
    (BREAK_PENDING_APPROVAL_STATUSES as readonly string[]).includes(row.status),
  );
  const pollTarget = activeBreak ? upcomingBreaks[0] : upcomingBreaks[0] ?? null;

  useActivateDueBreaksPoll(userId, qc, {
    plannedStartIso: pollTarget ? breakStartIso(pollTarget) : null,
    isActive: !!activeBreak,
  });

  useEffect(() => {
    // Countdown only needed for active/upcoming break tiles.
    if (!activeBreak && upcomingBreaks.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeBreak?.id, upcomingBreaks.length]);

  const endMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("end_my_break", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("סומן: חזרת מההפסקה");
      qc.invalidateQueries({ queryKey: ["my-break-shortcut", userId] });
      qc.invalidateQueries({ queryKey: ["my-active-break", userId] });
      qc.invalidateQueries({ queryKey: ["my-breaks-today"] });
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const goRequest = () => navigate({ to: "/breaks" });
  const hasBreakCards = !!activeBreak || upcomingBreaks.length > 0 || pendingBreaks.length > 0;

  if (!hasBreakCards) {
    if (shiftGate.isLoading || canRequestQ.isLoading) return null;
    if (!shiftGate.isVisible || !canRequestBreak) return null;
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={goRequest}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") goRequest(); }}
        className={`${DASH_TILE} cursor-pointer border border-primary/30 bg-primary/5 hover:bg-primary/10`}
      >
        <div className="flex h-full w-full items-center gap-2.5">
          <div className={`${DASH_TILE_ICON} bg-primary/15 text-primary`}>
            <Coffee className="size-4" />
          </div>
          <div className="min-w-0 flex-1 self-center">
            <h3 className={DASH_TILE_TITLE}>הפסקה</h3>
            <p className={DASH_TILE_SUB}>
              בקש/י הפסקה במהירות, ללא מעבר לתפריט.
            </p>
          </div>
          <div className={DASH_TILE_TRAIL}>
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => { e.stopPropagation(); goRequest(); }}
            >
              <Send className="size-3" />
              בקשה
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {pendingBreaks.map((row) => (
        <DashboardPendingBreakCard key={row.id} row={row} />
      ))}
      {activeBreak && (
        <DashboardActiveBreakCard
          row={activeBreak}
          onEnd={() => endMut.mutate(activeBreak.id)}
          ending={endMut.isPending}
        />
      )}
      {upcomingBreaks.map((row) => (
        <DashboardUpcomingBreakCard key={row.id} row={row} />
      ))}
    </div>
  );
}


type ManagerOnBreakRow = {
  id: string;
  userId: string;
  name: string;
  job_title: string | null;
  role_label: string | null;
  department: string;
  type: string;
  durationMinutes: number;
  startedAt: string | null;
  endsAt: string | null;
  approverName: string;
};

function OnBreakSection({ profile }: { profile: any }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [listKind, setListKind] = useState<"onBreak" | "late" | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logEmpFilter, setLogEmpFilter] = useState<string>("__all");
  const [logDeptFilter, setLogDeptFilter] = useState<string>("__all");
  const [logTypeFilter, setLogTypeFilter] = useState<string>("__all");
  const [logStatusFilter, setLogStatusFilter] = useState<string>("__all");
  const [logSort, setLogSort] = useState<"created" | "overrun" | "return">("created");
  const [confirmReturn, setConfirmReturn] = useState<{ id: string; userId: string; name: string } | null>(null);
  const [onBreakTick, setOnBreakTick] = useState(0);
  const [breaksOpen, setBreaksOpen] = useState(false);
  // Parent mounts this for anyone with break view access; manage actions stay gated.
  const { canManageBreaks } = useCanManageBreaks();
  const { requiresApproval } = useBreakRequiresApproval();

  const onBreakQ = useQuery({
    enabled: true,
    queryKey: ["dashboard-on-break"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select(
          "id, user_id, department_id, break_setting_id, started_at, ends_at, approved_by, duration_minutes",
        )
        .eq("status", "active");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (!rows.length) return [] as ManagerOnBreakRow[];

      const uids = Array.from(
        new Set(rows.flatMap((r) => [r.user_id, r.approved_by].filter(Boolean))),
      );
      const dids = Array.from(new Set(rows.map((r) => r.department_id).filter(Boolean)));
      const sids = Array.from(new Set(rows.map((r) => r.break_setting_id).filter(Boolean)));
      const [{ data: profs }, { data: depts }, { data: settings }, { data: meta }] =
        await Promise.all([
          supabase.from("profiles").select("id, full_name, job_title").in("id", uids),
          dids.length
            ? supabase.from("departments").select("id, name").in("id", dids)
            : Promise.resolve({ data: [] as any[] }),
          sids.length
            ? supabase.from("break_settings").select("id, name").in("id", sids)
            : Promise.resolve({ data: [] as any[] }),
          (supabase as any).rpc("get_profiles_basic_info", { user_ids: uids }),
        ]);
      const pMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const dMap = new Map((depts ?? []).map((d: any) => [d.id, d.name]));
      const sMap = new Map((settings ?? []).map((s: any) => [s.id, s.name]));
      const mMap = new Map((meta ?? []).map((m: any) => [m.id, m]));

      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id as string,
        name: (pMap.get(r.user_id) as any)?.full_name ?? "—",
        job_title:
          (mMap.get(r.user_id) as any)?.job_title ??
          (pMap.get(r.user_id) as any)?.job_title ??
          null,
        role_label: (mMap.get(r.user_id) as any)?.role_label ?? null,
        department: dMap.get(r.department_id) ?? "—",
        type: sMap.get(r.break_setting_id) ?? "הפסקה",
        durationMinutes: r.duration_minutes as number,
        startedAt: r.started_at as string | null,
        endsAt: r.ends_at as string | null,
        approverName:
          r.approved_by ? (pMap.get(r.approved_by) as any)?.full_name ?? "—" : "—",
      }));
    },
  });

  const pendingCountQ = useQuery({
    enabled: canManageBreaks && requiresApproval,
    queryKey: ["dashboard-pending-breaks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select("id")
        .eq("status", "pending_approval");
      if (error) throw error;
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      return {
        count: ids.length,
        signature: attentionSignatureFromIds(ids),
      };
    },
  });

  const pendingBreakCount = pendingCountQ.data?.count ?? 0;
  const pendingBreakSig = pendingCountQ.data?.signature ?? "";
  const { needsAttention: pendingBreakAttention, markSeen: markPendingBreakSeen } =
    useDashboardCardAttention(profile?.id, "breaks-pending", pendingBreakSig);

  // Tile count + ids for attention signature — full journal enrichment loads when dialog opens.
  const dailyLogCountQ = useQuery({
    enabled: true,
    queryKey: ["dashboard-daily-breaks-count"],
    staleTime: 30_000,
    queryFn: async () => {
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from("break_requests")
        .select("id")
        .gte("created_at", dayStart.toISOString())
        .lt("created_at", dayEnd.toISOString());
      if (error) throw error;
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      return {
        count: ids.length,
        signature: attentionSignatureFromIds(ids),
      };
    },
  });

  // Daily log: all break requests created today (Asia/Jerusalem)
  const dailyLogQ = useQuery({
    enabled: logOpen,
    queryKey: ["dashboard-daily-breaks"],
    staleTime: 30_000,
    queryFn: async () => {
      const now = new Date();
      // Local Israel-day window. Use local midnight; Supabase will compare as UTC.
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from("break_requests")
        .select(
          "id, user_id, department_id, break_setting_id, created_at, requested_at, planned_start, approved_at_time, approval_decided_at, started_at, ends_at, completed_at, status, approved_by, duration_minutes",
        )
        .gte("created_at", dayStart.toISOString())
        .lt("created_at", dayEnd.toISOString())
        .order("requested_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];
      const uids = Array.from(
        new Set(rows.flatMap((r) => [r.user_id, r.approved_by].filter(Boolean))),
      );
      const dids = Array.from(new Set(rows.map((r) => r.department_id).filter(Boolean)));
      const sids = Array.from(new Set(rows.map((r) => r.break_setting_id).filter(Boolean)));
      const [{ data: profs }, { data: depts }, { data: settings }, { data: meta }, { data: audits }] =
        await Promise.all([
          uids.length
            ? supabase.from("profiles").select("id, full_name, job_title").in("id", uids)
            : Promise.resolve({ data: [] as any[] }),
          dids.length
            ? supabase.from("departments").select("id, name").in("id", dids)
            : Promise.resolve({ data: [] as any[] }),
          sids.length
            ? supabase.from("break_settings").select("id, name").in("id", sids)
            : Promise.resolve({ data: [] as any[] }),
          uids.length
            ? (supabase as any).rpc("get_profiles_basic_info", { user_ids: uids })
            : Promise.resolve({ data: [] as any[] }),
          (supabase as any)
            .from("break_audit_log")
            .select("break_request_id, actor_id, occurred_at, action, payload")
            .in("action", ["manual_end", "reschedule"])
            .in("break_request_id", rows.map((r) => r.id)),
        ]);
      const pMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const dMap = new Map((depts ?? []).map((d: any) => [d.id, d.name]));
      const sMap = new Map((settings ?? []).map((s: any) => [s.id, s.name]));
      const mMap = new Map((meta ?? []).map((m: any) => [m.id, m]));
      const auditList = (audits ?? []) as any[];
      const actorIds = Array.from(
        new Set(auditList.map((a) => a.actor_id).filter((x) => x && !pMap.has(x))),
      );
      if (actorIds.length) {
        const { data: actorProfs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", actorIds);
        for (const a of actorProfs ?? []) pMap.set((a as any).id, a);
      }
      const auditByReq = new Map<string, { by: string; at: string }>();
      const rescheduleByReq = new Map<
        string,
        { by: string; at: string; oldStart: string | null; newStart: string | null }
      >();
      for (const a of auditList) {
        const actorName = (pMap.get(a.actor_id) as any)?.full_name ?? "מנהל";
        if (a.action === "manual_end") {
          // keep earliest manual_end per break_request
          const prev = auditByReq.get(a.break_request_id);
          if (!prev || new Date(a.occurred_at) < new Date(prev.at)) {
            auditByReq.set(a.break_request_id, {
              by: actorName,
              at: a.occurred_at,
            });
          }
        } else if (a.action === "reschedule") {
          // keep latest reschedule per break_request
          const prev = rescheduleByReq.get(a.break_request_id);
          if (!prev || new Date(a.occurred_at) > new Date(prev.at)) {
            const payload = (a.payload ?? {}) as {
              old_start?: string | null;
              new_start?: string | null;
            };
            rescheduleByReq.set(a.break_request_id, {
              by: actorName,
              at: a.occurred_at,
              oldStart: payload.old_start ?? null,
              newStart: payload.new_start ?? null,
            });
          }
        }
      }
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id as string,
        name: (pMap.get(r.user_id) as any)?.full_name ?? "—",
        jobTitle:
          (mMap.get(r.user_id) as any)?.job_title ??
          (pMap.get(r.user_id) as any)?.job_title ??
          null,
        roleLabel: (mMap.get(r.user_id) as any)?.role_label ?? null,
        departmentId: r.department_id as string | null,
        department: dMap.get(r.department_id) ?? "—",
        typeId: r.break_setting_id as string | null,
        type: sMap.get(r.break_setting_id) ?? "הפסקה",
        durationMinutes: r.duration_minutes as number,
        createdAt: r.created_at as string | null,
        requestedTime: r.requested_at as string | null,
        approvedTime: r.approved_at_time as string | null,
        approvalDecidedAt: r.approval_decided_at as string | null,
        plannedStart: r.planned_start as string | null,
        /** Effective start for display — actual or scheduled. */
        displayStart: breakStartIso(r) as string | null,
        startedAt: r.started_at as string | null,
        endsAt: r.ends_at as string | null,
        completedAt: r.completed_at as string | null,
        status: r.status as string,
        approverName: r.approved_by ? (pMap.get(r.approved_by) as any)?.full_name ?? "—" : "—",
        manualReturn: auditByReq.get(r.id) ?? null,
        reschedule: rescheduleByReq.get(r.id) ?? null,
      }));
    },
  });

  const manualEndMut = useMutation({
    mutationFn: async (input: { id: string; userId: string }) => {
      const { error } = await (supabase as any).rpc("manual_end_break", { _id: input.id });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      toast.success("ההפסקה הסתיימה");
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-dept-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-dept-daily-breaks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks-count"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      qc.invalidateQueries({ queryKey: ["employees-page-active-breaks"] });
      qc.invalidateQueries({ queryKey: ["all-break-requests"] });
      qc.invalidateQueries({ queryKey: ["my-active-break", input.userId] });
      qc.invalidateQueries({ queryKey: ["my-break-shortcut", input.userId] });
      qc.invalidateQueries({ queryKey: ["my-break-requests", input.userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בסיום ההפסקה"),
  });



  // Live split for late tile — 5s when closed, 1s while list dialog is open.
  useEffect(() => {
    if ((onBreakQ.data?.length ?? 0) === 0) return;
    const ms = listKind !== null ? 1000 : 5000;
    const t = setInterval(() => setOnBreakTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [onBreakQ.data?.length, listKind]);

  const list = onBreakQ.data ?? [];
  const log = dailyLogQ.data ?? [];
  const logCount = dailyLogCountQ.data?.count ?? log.length;
  const journalSig =
    dailyLogCountQ.data?.signature ??
    attentionSignatureFromIds(log.map((r) => r.id));
  void onBreakTick; // recompute on/late split on tick
  const nowMs = Date.now();
  const onBreakNow = list.filter((r) => !isBreakOverdue(r.endsAt, nowMs));
  const lateList = list.filter((r) => isBreakOverdue(r.endsAt, nowMs));
  const onBreakSig = attentionSignatureFromIds(onBreakNow.map((r) => r.id));
  const lateSig = attentionSignatureFromIds(lateList.map((r) => r.id));
  const onBreakAttn = useDashboardCardAttention(profile?.id, "branch-on-break-now", onBreakSig);
  const lateAttn = useDashboardCardAttention(profile?.id, "branch-on-break-late", lateSig);
  const journalAttn = useDashboardCardAttention(profile?.id, "branch-break-journal", journalSig);
  const sectionSig = [pendingBreakSig, onBreakSig, lateSig, journalSig]
    .filter(Boolean)
    .join("|");
  const sectionAttn = useDashboardCardAttention(
    profile?.id,
    "branch-breaks-section",
    sectionSig,
  );
  const alertCount = pendingBreakCount + onBreakNow.length + lateList.length;
  const sectionNeedsAttention = sectionAttn.needsAttention;
  const dialogList = listKind === "late" ? lateList : listKind === "onBreak" ? onBreakNow : [];

  const fmtT = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("he-IL", {
          timeZone: "Asia/Jerusalem",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(iso))
      : "—";

  const STATUS_LABEL = BREAK_STATUS_LABEL;
  const STATUS_TONE = BREAK_STATUS_TONE;


  return (
    <>
      <Collapsible
        open={breaksOpen}
        onOpenChange={(open) => {
          setBreaksOpen(open);
          if (open) sectionAttn.markSeen();
        }}
      >
        <Card
          className={
            sectionNeedsAttention && !breaksOpen
              ? `card-elevated overflow-hidden ${DASH_TILE_ATTENTION}`
              : "card-elevated overflow-hidden"
          }
        >
          <div className="flex items-stretch gap-1 p-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-right outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className={
                    sectionNeedsAttention && !breaksOpen
                      ? `${DASH_TILE_ICON} bg-destructive/20 text-destructive`
                      : `${DASH_TILE_ICON} bg-primary/15 text-primary`
                  }
                >
                  <Coffee className="size-4" />
                </div>
                <div className="min-w-0 flex-1 self-center">
                  <h3
                    className={
                      sectionNeedsAttention && !breaksOpen
                        ? `${DASH_TILE_TITLE} text-destructive`
                        : DASH_TILE_TITLE
                    }
                  >
                    הפסקות
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {pendingBreakCount > 0
                      ? `${pendingBreakCount} ממתינות · ${onBreakNow.length} בהפסקה · ${lateList.length} מאחרים`
                      : alertCount > 0
                        ? `${onBreakNow.length} בהפסקה · ${lateList.length} מאחרים · יומן ${logCount}`
                        : logCount > 0
                          ? `יומן היום: ${logCount}`
                          : "אין פעילות הפסקות כרגע"}
                  </p>
                </div>
                <div className={`${DASH_TILE_TRAIL} gap-1.5`}>
                  {sectionNeedsAttention && !breaksOpen ? (
                    <Badge variant="destructive" className="rounded-full px-2">
                      {Math.max(pendingBreakCount + onBreakNow.length + lateList.length, 1)}
                    </Badge>
                  ) : null}
                  <ChevronDown
                    className={`size-4 text-muted-foreground transition-transform ${
                      breaksOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
            {canManageBreaks ? (
              <button
                type="button"
                className="shrink-0 self-center px-2 text-xs text-primary hover:underline"
                onClick={() => {
                  sectionAttn.markSeen();
                  navigate({ to: "/breaks-admin" });
                }}
              >
                ניהול
              </button>
            ) : null}
          </div>

          <CollapsibleContent>
            <div className={`border-t p-3 ${DASH_TILE_GRID}`}>
              {canManageBreaks && requiresApproval && (
                <StatCard
                  label="בקשות הפסקה ממתינות לאישור"
                  value={pendingBreakCount}
                  icon={Clock}
                  tone="warning"
                  onClick={() => {
                    markPendingBreakSeen();
                    navigate({ to: "/breaks-admin" });
                  }}
                  badge={pendingBreakCount}
                  attention={pendingBreakAttention}
                />
              )}
              <StatCard
                label="עובדים בהפסקה כעת"
                value={onBreakNow.length}
                icon={Coffee}
                tone={onBreakNow.length > 0 ? "warning" : "primary"}
                onClick={() => {
                  onBreakAttn.markSeen();
                  setListKind("onBreak");
                }}
                badge={onBreakNow.length}
                attention={onBreakAttn.needsAttention}
              />
              <StatCard
                label="עובדים מאחרים מהפסקה"
                value={lateList.length}
                icon={AlertTriangle}
                tone="muted"
                onClick={() => {
                  lateAttn.markSeen();
                  setListKind("late");
                }}
                badge={lateList.length}
                attention={lateAttn.needsAttention}
              />
              <StatCard
                label="יומן הפסקות"
                value={logCount}
                icon={Coffee}
                tone="muted"
                badge={logCount}
                attention={journalAttn.needsAttention}
                onClick={() => {
                  journalAttn.markSeen();
                  setLogOpen(true);
                }}
              />
              {canManageBreaks && (
                <Card
                  className={`${DASH_TILE} cursor-pointer hover:bg-accent/30`}
                  onClick={() => navigate({ to: "/breaks-admin" })}
                >
                  <div className="flex h-full w-full items-center gap-2.5">
                    <div className={`${DASH_TILE_ICON} bg-primary/15 text-primary`}>
                      <Coffee className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 self-center text-right">
                      <p className={DASH_TILE_TITLE}>ניהול בקשות הפסקה</p>
                      <p className={DASH_TILE_SUB}>פתח מסך הפסקות</p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="size-5 text-primary" />
              📋 יומן ההפסקות
              <span className="text-xs font-normal text-muted-foreground mr-2">
                {new Intl.DateTimeFormat("he-IL", {
                  timeZone: "Asia/Jerusalem",
                  dateStyle: "full",
                  numberingSystem: "latn",
                  calendar: "gregory",
                }).format(new Date())}
              </span>
            </DialogTitle>
          </DialogHeader>

          {(() => {
            const employees = Array.from(
              new Map(log.map((r) => [r.userId, r.name])).entries(),
            ).sort((a, b) => a[1].localeCompare(b[1], "he"));
            const departments = Array.from(new Set(log.map((r) => r.department))).sort();
            const types = Array.from(new Set(log.map((r) => r.type))).sort();
            const statuses = Array.from(new Set(log.map((r) => r.status)));

            const enriched = log.map((r) => {
              const startedMs = r.startedAt ? new Date(r.startedAt).getTime() : null;
              const endsMs = r.endsAt ? new Date(r.endsAt).getTime() : null;
              const completedMs = r.completedAt ? new Date(r.completedAt).getTime() : null;
              const actualDurMin =
                startedMs && completedMs
                  ? Math.max(0, Math.round((completedMs - startedMs) / 60000))
                  : null;
              const overrunMin =
                completedMs && endsMs && completedMs > endsMs
                  ? Math.round((completedMs - endsMs) / 60000)
                  : r.status === "active" && endsMs && Date.now() > endsMs
                    ? Math.round((Date.now() - endsMs) / 60000)
                    : 0;
              const returnedOnTime =
                r.status === "completed" && completedMs && endsMs && completedMs <= endsMs;
              const returnedLate = r.status === "completed" && overrunMin > 0;
              return {
                ...r,
                actualDurMin,
                overrunMin,
                returnedOnTime: !!returnedOnTime,
                returnedLate,
              };
            });

            const filtered = enriched.filter((r) => {
              if (logEmpFilter !== "__all" && r.userId !== logEmpFilter) return false;
              if (logDeptFilter !== "__all" && r.department !== logDeptFilter) return false;
              if (logTypeFilter !== "__all" && r.type !== logTypeFilter) return false;
              if (logStatusFilter !== "__all" && r.status !== logStatusFilter) return false;
              if (logSearch.trim()) {
                const q = logSearch.trim().toLowerCase();
                const hay = [r.name, r.department, r.type, r.jobTitle, r.roleLabel, r.approverName]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });

            const sorted = [...filtered].sort((a, b) => {
              if (logSort === "overrun") return (b.overrunMin || 0) - (a.overrunMin || 0);
              if (logSort === "return") {
                const av = a.completedAt ? new Date(a.completedAt).getTime() : 0;
                const bv = b.completedAt ? new Date(b.completedAt).getTime() : 0;
                return bv - av;
              }
              const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return av - bv;
            });

            return (
              <>
                <div
                  className={
                    departments.length > 1
                      ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3"
                      : "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-3"
                  }
                >
                  <Input
                    placeholder="🔎 חיפוש..."
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                  />
                  <Select value={logEmpFilter} onValueChange={setLogEmpFilter}>
                    <SelectTrigger><SelectValue placeholder="עובד" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">כל העובדים</SelectItem>
                      {employees.map(([id, name]) => (
                        <SelectItem key={id} value={id}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {departments.length > 1 && (
                    <Select value={logDeptFilter} onValueChange={setLogDeptFilter}>
                      <SelectTrigger><SelectValue placeholder="מחלקה" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all">כל המחלקות</SelectItem>
                        {departments.map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={logTypeFilter} onValueChange={setLogTypeFilter}>
                    <SelectTrigger><SelectValue placeholder="סוג הפסקה" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">כל הסוגים</SelectItem>
                      {types.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={logStatusFilter} onValueChange={setLogStatusFilter}>
                    <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">כל הסטטוסים</SelectItem>
                      {statuses.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABEL[s] ?? s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={logSort} onValueChange={(v: any) => setLogSort(v)}>
                    <SelectTrigger><SelectValue placeholder="מיון" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created">לפי שעת בקשה</SelectItem>
                      <SelectItem value="overrun">לפי זמן חריגה</SelectItem>
                      <SelectItem value="return">לפי זמן חזרה</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="overflow-auto max-h-[65vh] border rounded-md">
                  {dailyLogQ.isLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-primary" />
                    </div>
                  ) : sorted.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground text-center">
                      לא נמצאו רשומות התואמות את הסינון.
                    </p>
                  ) : (
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr>
                          <th className="text-right p-2">👤 עובד</th>
                          <th className="text-right p-2">💼 תפקיד</th>
                          {departments.length > 1 && (
                            <th className="text-right p-2">🏬 מחלקה</th>
                          )}
                          <th className="text-right p-2">☕ סוג</th>
                          <th className="text-right p-2">👤 אישר</th>
                          <th className="text-right p-2">🕒 התחלה / מתוכננת</th>
                          <th className="text-right p-2">🏁 סיום מתוכנן</th>
                          <th className="text-right p-2">🕒 חזרה בפועל</th>
                          <th className="text-right p-2">⏱️ משך בפועל</th>
                          <th className="text-right p-2">🔴 חריגה</th>
                          <th className="text-right p-2">📅 תאריך</th>
                          <th className="text-right p-2">📌 סטטוס</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((r) => {
                          const dateStr = r.createdAt
                            ? new Intl.DateTimeFormat("he-IL", {
                                timeZone: "Asia/Jerusalem",
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                numberingSystem: "latn",
                              }).format(new Date(r.createdAt))
                            : "—";
                          const isLate = r.returnedLate;
                          const isOnTime = r.returnedOnTime;
                          const isActiveRow = r.status === "active";
                          const statusBadge = isActiveRow ? (
                            <Badge className="bg-amber-500 text-white hover:bg-amber-500">🟡 בהפסקה</Badge>
                          ) : isOnTime ? (
                            <Badge className="bg-green-600 text-white hover:bg-green-600">🟢 חזר בזמן</Badge>
                          ) : isLate ? (
                            <Badge className="bg-red-600 text-white hover:bg-red-600">🔴 חזר באיחור</Badge>
                          ) : (
                            <Badge variant={STATUS_TONE[r.status] ?? "secondary"}>
                              {STATUS_LABEL[r.status] ?? r.status}
                            </Badge>
                          );
                          const rowTone = isOnTime
                            ? "bg-green-50 dark:bg-green-950/30 border-r-4 border-r-green-600"
                            : isLate
                              ? "bg-red-50 dark:bg-red-950/30 border-r-4 border-r-red-600"
                              : isActiveRow
                                ? "bg-amber-50 dark:bg-amber-950/20 border-r-4 border-r-amber-500"
                                : "";
                          return (
                            <tr key={r.id} className={"border-t align-top " + rowTone}>

                              <td className="p-2 font-medium whitespace-nowrap">{r.name}</td>
                              <td className="p-2 whitespace-nowrap text-muted-foreground">
                                {r.roleLabel ?? "—"}
                                {r.jobTitle ? ` · ${r.jobTitle}` : ""}
                              </td>
                              {departments.length > 1 && (
                                <td className="p-2 whitespace-nowrap">{r.department}</td>
                              )}
                              <td className="p-2 whitespace-nowrap">{r.type}</td>
                              <td className="p-2 whitespace-nowrap">{r.approverName}</td>
                              <td className="p-2 whitespace-nowrap">
                                {fmtT(r.displayStart ?? r.startedAt)}
                                {r.reschedule ? (
                                  <div className="text-[11px] text-muted-foreground mt-0.5 whitespace-normal">
                                    שונה ע״י {r.reschedule.by}:{" "}
                                    {fmtT(r.reschedule.oldStart)} → {fmtT(r.reschedule.newStart)}
                                  </div>
                                ) : null}
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                {fmtT(
                                  r.endsAt ??
                                    (r.displayStart && r.durationMinutes
                                      ? new Date(
                                          new Date(r.displayStart).getTime() +
                                            r.durationMinutes * 60_000,
                                        ).toISOString()
                                      : null),
                                )}
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                {fmtT(r.completedAt)}
                                {r.manualReturn ? (
                                  <div className="text-[11px] text-muted-foreground mt-0.5 whitespace-normal">
                                    הוחזר מהפסקה על ידי: {r.manualReturn.by}
                                    <br />
                                    ({fmtT(r.manualReturn.at)})
                                  </div>
                                ) : null}
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                {r.actualDurMin != null ? `${r.actualDurMin} דק׳` : "—"}
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                {r.overrunMin > 0 ? (
                                  <span className="text-red-600 font-bold">+{r.overrunMin} דק׳</span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="p-2 whitespace-nowrap">{dateStr}</td>
                              <td className="p-2">{statusBadge}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  סה״כ: {sorted.length} מתוך {log.length}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>




      <Dialog
        open={listKind !== null}
        onOpenChange={(o) => {
          if (!o) setListKind(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {listKind === "late" ? "עובדים מאחרים מהפסקה" : "עובדים בהפסקה כעת"}
            </DialogTitle>
          </DialogHeader>
          {dialogList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {listKind === "late"
                ? "אין עובדים מאחרים מהפסקה כרגע."
                : "אין עובדים בהפסקה כרגע."}
            </p>
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
              {dialogList.map((r) => {
                const endsTs = r.endsAt ? new Date(r.endsAt).getTime() : 0;
                const now = Date.now();
                const remainingMs = endsTs ? endsTs - now : 0;
                const overrunMs = endsTs && now > endsTs ? now - endsTs : 0;
                const remMin = Math.max(0, Math.ceil(remainingMs / 60000));
                const overMin = Math.ceil(overrunMs / 60000);
                const startStr = fmtT(r.startedAt);
                const endStr = fmtT(r.endsAt);
                return (
                  <li
                    key={r.id}
                    className={
                      "rounded-md border p-3 flex items-center justify-between gap-3 " +
                      (overrunMs > 0 ? "border-red-400 bg-red-50/40" : "border-border/60")
                    }
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        👤 {r.name}
                        {r.role_label ? ` · 💼 ${r.role_label}` : ""}
                        {r.job_title ? ` · ${r.job_title}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        🏬 {r.department} · ☕ {r.type} · התחיל ב־{startStr} · 🕒 חזרה משוערת:{" "}
                        {endStr}
                      </p>
                      <p className="text-xs text-muted-foreground">אישר/ה: {r.approverName}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {overrunMs > 0 ? (
                        <Badge variant="destructive">🔴 חריגה {overMin} דק׳</Badge>
                      ) : (
                        <Badge variant="secondary">⏳ נותר {remMin} דק׳</Badge>
                      )}
                      {canManageBreaks && (
                        <Button
                          size="sm"
                          variant={overrunMs > 0 ? "destructive" : "outline"}
                          className="gap-1"
                          onClick={() =>
                            setConfirmReturn({ id: r.id, userId: r.userId, name: r.name })
                          }
                          disabled={manualEndMut.isPending}
                        >
                          {manualEndMut.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-4" />
                          )}
                          החזר מההפסקה
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmReturn}
        onOpenChange={(o) => { if (!o) setConfirmReturn(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>כבר להחזיר את העובד מההפסקה?</AlertDialogTitle>
            {confirmReturn?.name ? (
              <AlertDialogDescription>
                {confirmReturn.name}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmReturn) {
                  manualEndMut.mutate({ id: confirmReturn.id, userId: confirmReturn.userId });
                }
                setConfirmReturn(null);
              }}
            >
              אישור
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}



