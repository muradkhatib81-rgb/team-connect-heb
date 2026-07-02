import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  ROLE_LABELS,
  DEPARTMENT_LABELS,
  highestRole,
  isAdmin,
  canManageUsers,
  type AppRole,
} from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserCheck, UserX, Building2, Loader2, Plane, ListTodo, Clock, CheckCircle2, AlertTriangle, CalendarDays, Sun, Moon, User, Coffee, RefreshCw, Send, UserPlus } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { EmployeeOfMonthSection } from "@/components/employee-of-month-section";
import { formatHeDateTime } from "@/lib/date-format";
import { CreateEmployeeDialog } from "./employees";
import { ManagementOnShiftCard } from "@/components/management-on-shift-card";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type DeptRow = { id: string; name: string; is_active: boolean };

function DashboardPage() {
  const { data: profile } = useAuth();
  const admin = profile ? isAdmin(profile.roles) : false;
  const isDeptManager = profile ? profile.roles.includes("department_manager") : false;
  const queryClient = useQueryClient();
  const [deptDialogId, setDeptDialogId] = useState<string | null>(null);
  const [empDialogId, setEmpDialogId] = useState<string | null>(null);



  const statsQuery = useQuery({
    enabled: admin,
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const [
        { data: profs, error: pErr },
        { data: depts, error: dErr },
        { data: breaks, error: bErr },
      ] = await Promise.all([
        supabase.from("profiles").select("id, is_active, on_leave, department_id, excluded_from_headcount"),
        supabase.from("departments").select("id, name, is_active").order("name"),
        supabase.from("break_requests").select("user_id").eq("status", "active"),
      ]);
      if (pErr) throw pErr;
      if (dErr) throw dErr;
      if (bErr) throw bErr;
      // Employees flagged as "excluded from headcount" remain in the system but
      // are not counted in any headcount statistic (totals, by-department, etc.).
      const counted = profs!.filter((d: any) => !d.excluded_from_headcount);
      const total = counted.length;
      const onLeave = counted.filter((d: any) => d.on_leave).length;
      const active = counted.filter((d: any) => d.is_active && !d.on_leave).length;
      const inactive = counted.filter((d: any) => !d.is_active).length;
      const excludedIds = new Set(profs!.filter((d: any) => d.excluded_from_headcount).map((d: any) => d.id));
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

  // Department manager: always reload their department employees on mount.
  // The manager is excluded from the employees list at the source (Query level).
  const deptManagerQuery = useQuery({
    enabled: !admin && isDeptManager && !!profile,
    queryKey: ["dashboard", "dept-manager", profile?.id],
    refetchOnMount: "always",
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
          .select("id, full_name, is_active, on_leave, avatar_url, department_id, job_title")
          .eq("department_id", dept.id)
          .neq("id", profile!.id) // exclude the department manager themselves
          .order("full_name");
        if (eErr) throw eErr;
        employees = (emps ?? []) as DeptEmp[];

        const { data: mgr } = await supabase
          .from("profiles")
          .select("id, full_name, job_title, avatar_url")
          .eq("id", profile!.id)
          .maybeSingle();
        if (mgr) manager = mgr as NonNullable<typeof manager>;
      }

      return { dept, employees, manager };
    },
  });


  // Tasks stats (visible to anyone who can see at least their dept tasks)
  const tasksStatsQuery = useQuery({
    enabled: !!profile,
    queryKey: ["dashboard", "tasks-stats"],
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, due_at, completed_at");
      if (error) throw error;
      const rows = (data ?? []) as { id: string; status: string; due_at: string | null; completed_at: string | null }[];
      const now = Date.now();
      return {
        open: rows.filter((r) => r.status === "new").length,
        in_progress: rows.filter((r) => r.status === "in_progress").length,
        completed: rows.filter((r) => r.status === "completed").length,
        overdue: rows.filter((r) => r.due_at && r.status !== "completed" && new Date(r.due_at).getTime() < now).length,
      };
    },
  });

  // Realtime: refresh when departments or profiles or tasks change
  useEffect(() => {
    if (!admin && !isDeptManager && !profile) return;
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["departments"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dashboard", "tasks-stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "break_requests" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [admin, isDeptManager, profile, queryClient]);

  if (!profile) return null;
  const top = highestRole(profile.roles);

  return (
    <div className="space-y-8">
      <ManagementOnShiftCard />

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

      <EmployeeOfMonthSection />


      {admin || isDeptManager ? (
        <>
          {isDeptManager && !admin ? (
            <BreakShortcutCard userId={profile.id} />
          ) : (
            <MyActiveBreakCard userId={profile.id} />
          )}
          <TasksStatsSection stats={tasksStatsQuery.data} loading={tasksStatsQuery.isLoading} />
          <SchedulesStatsSection profile={profile} />
          <OnBreakSection profile={profile} />

          {admin ? (
            <AdminDashboard stats={statsQuery.data} loading={statsQuery.isLoading} onSelectDept={setDeptDialogId} canCreateEmployee={profile ? canManageUsers(profile.roles) : false} currentUserRoles={profile.roles} />
          ) : (
            <DeptManagerDashboard data={deptManagerQuery.data} loading={deptManagerQuery.isLoading} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EmployeeNewMessagesCard userId={profile.id} />
            <EmployeeNewAnnouncementsCard userId={profile.id} />
          </div>
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

function TasksStatsSection({
  stats,
  loading,
}: {
  stats?: { open: number; in_progress: number; completed: number; overdue: number };
  loading: boolean;
}) {
  const navigate = useNavigate();
  if (loading || !stats) return null;
  const go = (status: string) => navigate({ to: "/tasks", search: { status } as any });
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ListTodo className="size-5 text-primary" />
          משימות
        </h2>
        <Link to="/tasks" className="text-sm text-primary hover:underline">
          לכל המשימות ←
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="פתוחות" value={stats.open} icon={ListTodo} tone="primary" onClick={() => go("new")} />
        <StatCard label="בביצוע" value={stats.in_progress} icon={Clock} tone="success" onClick={() => go("in_progress")} />
        <StatCard label="הושלמו" value={stats.completed} icon={CheckCircle2} tone="muted" onClick={() => go("completed")} />
        <StatCard label="באיחור" value={stats.overdue} icon={AlertTriangle} tone="warning" onClick={() => go("overdue")} />
      </div>
    </section>
  );
}

type DeptEmp = {
  id: string;
  full_name: string;
  is_active: boolean;
  on_leave: boolean;
  avatar_url: string | null;
  department_id: string | null;
};

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
  const navigate = useNavigate();
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
        עדיין לא שויכת כאחראי מחלקה. פנה לבעל המערכת הראשי.
      </Card>
    );
  }
  // Manager is already excluded at the Query level (see deptManagerQuery).
  const emps = data.employees;
  const total = emps.length;
  const active = emps.filter((e) => e.is_active && !e.on_leave).length;
  const onLeave = emps.filter((e) => e.on_leave).length;
  const inactive = emps.filter((e) => !e.is_active).length;
  const go = () =>
    navigate({ to: "/employees", search: { filter: "all", dept: data.dept!.id } as any });
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
              <div className="text-sm text-muted-foreground truncate">
                {data.dept.name}
                {mgr.job_title ? ` · ${mgr.job_title}` : ""}
              </div>
            </div>
            <div className="text-sm text-muted-foreground whitespace-nowrap">
              עובדים במחלקה: <span className="font-semibold text-foreground">{total}</span>
            </div>
          </div>
        </Card>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="עובדי המחלקה" value={total} icon={Users} tone="primary" onClick={go} />
        <StatCard label="פעילים" value={active} icon={UserCheck} tone="success" onClick={go} />
        <StatCard label="בחופש" value={onLeave} icon={Plane} tone="warning" onClick={go} />
        <StatCard label="לא פעילים" value={inactive} icon={UserX} tone="muted" onClick={go} />
      </section>


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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {emps.map((e) => (
              <Card key={e.id} className="card-elevated p-4">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-sm font-semibold shrink-0 overflow-hidden">
                    <span>{e.full_name?.charAt(0) || "?"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{e.full_name || "ללא שם"}</p>
                      {!e.is_active && (
                        <Badge variant="destructive" className="rounded-full text-xs">לא פעיל</Badge>
                      )}
                      {e.on_leave && (
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
  currentUserRoles,
}: {
  stats?: { total: number; active: number; inactive: number; onLeave: number; onBreak: number; byDept: Record<string, number>; departments: DeptRow[] };
  loading: boolean;
  onSelectDept?: (id: string) => void;
  canCreateEmployee: boolean;
  currentUserRoles?: AppRole[];
}) {
  const navigate = useNavigate();
  const [createForDept, setCreateForDept] = useState<DeptRow | null>(null);
  if (loading || !stats) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  const go = (filter: string) =>
    navigate({ to: "/employees", search: { filter, dept: "all" } as any });
  const goDept = (id: string) =>
    navigate({ to: "/employees", search: { filter: "all", dept: id } as any });

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="👥 סך עובדים" value={stats.total} icon={Users} tone="primary" onClick={() => go("all")} />
        <StatCard label="🟢 עובדים פעילים" value={stats.active} icon={UserCheck} tone="success" onClick={() => go("active")} />
        <StatCard label="🏖️ בחופשה" value={stats.onLeave} icon={Plane} tone="warning" onClick={() => go("on_leave")} />
        <StatCard label="❌ עובדים לא פעילים" value={stats.inactive} icon={UserX} tone="muted" onClick={() => go("inactive")} />
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            עובדים לפי מחלקה
          </h2>
          <Link to="/employees" className="text-sm text-primary hover:underline">
            לכל העובדים ←
          </Link>
        </div>
        {stats.departments.length === 0 ? (
          <Card className="card-elevated p-6 text-sm text-muted-foreground">
            עדיין לא הוגדרו מחלקות. ניתן להוסיף דרך מסך ניהול המחלקות.
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {stats.departments.map((d) => (
              <Card
                key={d.id}
                className="card-elevated p-4 cursor-pointer hover:bg-accent/30 transition-colors text-right"
                onClick={() => onSelectDept?.(d.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectDept?.(d.id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{d.name}</p>
                    <p className="text-2xl font-bold mt-1">{stats.byDept[d.id] ?? 0}</p>
                  </div>
                  {canCreateEmployee && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 gap-1 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCreateForDept(d);
                      }}
                      title="הוסף עובד למחלקה"
                    >
                      <UserPlus className="size-4" />
                      <span className="text-xs">הוסף</span>
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
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
        />
      )}
    </>
  );
}

function EmployeeDashboard({ profile }: { profile: any }) {
  return (
    <div className="space-y-6">
      <BreakShortcutCard userId={profile.id} />
      <EmployeeScheduleCard profile={profile} />
      <EmployeeNotificationsCard userId={profile.id} />
      <EmployeeNewMessagesCard userId={profile.id} />
      <EmployeeNewAnnouncementsCard userId={profile.id} />
    </div>
  );
}

function getCurrentWeek() {
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
  return { weekStart: start, weekEnd: days[6], weekDays: days };
}

function EmployeeScheduleCard({ profile }: { profile: any }) {
  const qc = useQueryClient();
  const { weekStart, weekEnd, weekDays } = useMemo(() => getCurrentWeek(), []);
  const DAY_NAMES = ["שבת", "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];
  const heDate = (iso: string) =>
    new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      numberingSystem: "latn",
      calendar: "gregory",
    }).format(new Date(iso + "T00:00:00Z"));

  const q = useQuery({
    enabled: !!profile?.department_id,
    queryKey: ["emp-dash-schedule", profile.id, weekStart],
    queryFn: async () => {
      const { data: sched, error: schedErr } = await supabase
        .from("schedules")
        .select(
          "id, status, week_start, week_end, published_at, updated_at, approved_at, approved_by, submitted_at, created_by, updated_by",
        )
        .eq("department_id", profile.department_id)
        .lte("week_start", weekEnd)
        .gte("week_end", weekStart)
        .eq("status", "approved")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (schedErr) throw schedErr;
      if (!sched) return { sched: null, shifts: [] as any[], approver: null as any, editedBeforeApproval: false, scheduleModified: false };
      const { data: shifts, error: shiftsErr } = await supabase
        .from("schedule_shifts")
        .select("employee_id, day_date, shift, published_shift")
        .eq("schedule_id", sched.id)
        .eq("employee_id", profile.id);
      if (shiftsErr) throw shiftsErr;
      const scheduleModified =
        !!sched.published_at &&
        !!sched.updated_at &&
        new Date(sched.updated_at).getTime() > new Date(sched.published_at).getTime();

      let approver: any = null;
      let editedBeforeApproval = false;
      if (sched.approved_by) {
        const [{ data: prof }, { data: roles }, { data: auditRows }] = await Promise.all([
          supabase.from("profiles").select("id, full_name, job_title").eq("id", sched.approved_by).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", sched.approved_by),
          supabase
            .from("schedule_audit_log")
            .select("actor_id, action, created_at")
            .eq("schedule_id", sched.id),
        ]);
        const roleLabels: Record<string, string> = {
          main_admin: "בעל המערכת",
          branch_manager: "מנהל סניף",
          assistant_manager: "סגן מנהל",
          department_manager: "אחראי מחלקה",
          employee: "עובד",
        };
        const order = ["main_admin", "branch_manager", "assistant_manager", "department_manager", "employee"];
        const list = (roles ?? []).map((r: any) => r.role);
        list.sort((a: string, b: string) => order.indexOf(a) - order.indexOf(b));
        const topRole = list[0] ?? null;
        approver = {
          full_name: prof?.full_name ?? "—",
          job_title: prof?.job_title ?? null,
          role_label: topRole ? roleLabels[topRole] ?? topRole : null,
        };
        if (sched.submitted_at && sched.approved_at && auditRows) {
          const subT = new Date(sched.submitted_at).getTime();
          const appT = new Date(sched.approved_at).getTime();
          editedBeforeApproval = (auditRows as any[]).some((r) => {
            const t = new Date(r.created_at).getTime();
            return (
              r.action === "updated" &&
              t >= subT &&
              t <= appT &&
              r.actor_id && r.actor_id !== sched.created_by
            );
          });
        }
      }
      return {
        sched,
        shifts: (shifts ?? []) as any[],
        approver,
        editedBeforeApproval,
        scheduleModified,
      };
    },
  });

  useEffect(() => {
    if (!profile?.department_id) return;
    const ch = supabase
      .channel(`emp-dash-sched-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () =>
        qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_shifts" }, () =>
        qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.id, profile?.department_id, qc]);

  const sched = q.data?.sched as any;
  const shifts = (q.data?.shifts ?? []) as any[];
  const shiftByDay = new Map<string, { shift: string; published_shift: string | null }>();
  for (const s of shifts) shiftByDay.set(s.day_date, s);

  const SHIFT_LABEL: Record<string, string> = { morning: "בוקר", evening: "ערב", off: "חופש" };

  return (
    <Card className="card-elevated p-4 relative">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <CalendarDays className="size-5 text-primary" />
          סידור העבודה
        </h2>
        <Link to="/schedules" className="text-sm text-primary hover:underline">
          לסידור המלא ←
        </Link>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        {heDate(weekStart)} – {heDate(weekEnd)}
      </p>

      {sched && q.data?.approver && (
        <div
          className={`mb-3 p-2 rounded text-xs border ${
            q.data.editedBeforeApproval
              ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
          }`}
        >
          <p className="font-semibold">
            {q.data.editedBeforeApproval ? "✏️ נערך ואושר על ידי" : "✅ אושר על ידי"}
          </p>
          <p className="mt-0.5">
            👤 <span className="font-medium">{q.data.approver.full_name}</span>
            {q.data.approver.role_label && <span> · 💼 {q.data.approver.role_label}</span>}
            {q.data.approver.job_title && <span> ({q.data.approver.job_title})</span>}
          </p>
          <p>
            📅🕒{" "}
            <span className="font-medium">
              {formatHeDateTime(sched.approved_at ?? sched.published_at ?? sched.updated_at)}
            </span>
          </p>
        </div>
      )}

      {!sched ? (
        <p className="text-sm text-muted-foreground py-4">
          טרם פורסם סידור עבודה מאושר לשבוע זה.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {weekDays.map((d, i) => {
            const cell = shiftByDay.get(d);
            const sh = cell?.shift ?? "off";
            const isModified = !!cell && (cell.shift ?? null) !== (cell.published_shift ?? null);
            const tone =
              sh === "morning"
                ? "bg-amber-50 text-amber-900"
                : sh === "evening"
                  ? "bg-sky-50 text-sky-900"
                  : "bg-emerald-50 text-emerald-900";
            return (
              <div
                key={d}
                className={`relative rounded-md p-2 text-center ${tone} ${
                  isModified ? "ring-2 ring-orange-500 border border-orange-500" : ""
                }`}
              >
                <div className="text-xs font-medium">{DAY_NAMES[i]}</div>
                <div className="text-[11px] text-muted-foreground">{heDate(d)}</div>
                <div className="font-semibold mt-1">{SHIFT_LABEL[sh] ?? sh}</div>
                {isModified && (
                  <RefreshCw
                    className="size-3 text-orange-600 absolute -top-1 -left-1 bg-background rounded-full p-0.5 box-content border border-orange-500"
                    aria-label="עודכן לאחר פרסום"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function EmployeeNotificationsCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
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
  useEffect(() => {
    const ch = supabase
      .channel(`emp-dash-notif-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_notifications", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["emp-dash-notif", userId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);
  const items = q.data ?? [];
  return (
    <Card className="card-elevated p-4">
      <h2 className="font-semibold text-base flex items-center gap-2 mb-3">
        <AlertTriangle className="size-5 text-primary" />
        התראות
      </h2>
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
  const qc = useQueryClient();
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
  useEffect(() => {
    const invalidateMessages = () => qc.invalidateQueries({ queryKey: ["emp-dash-msgs", userId] });
    const ch = supabase
      .channel(`emp-dash-msg-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_recipients", filter: `user_id=eq.${userId}` },
        invalidateMessages,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        invalidateMessages,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_targets" },
        invalidateMessages,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);
  const items = q.data ?? [];
  const navigate = useNavigate();
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate({ to: "/communications", search: { tab: "inbox" } as any })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate({ to: "/communications", search: { tab: "inbox" } as any });
        }
      }}
      className="card-elevated p-4 cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30 transition-all"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-base flex items-center gap-2">
          📨 הודעות חדשות
          {items.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold">
              {items.length}
            </span>
          )}
        </h2>
        <span className="text-sm text-primary">לכל ההודעות ←</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין הודעות חדשות.</p>
      ) : (
        <ul className="divide-y">
          {items.map((r: any) => (
            <li key={r.message_id} className="py-2 text-sm">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({
                    to: "/communications",
                    search: { tab: "inbox", msg: r.message_id } as any,
                  });
                }}
                className="text-right hover:underline font-medium block w-full"
              >
                {r.message.title}
              </button>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(r.delivered_at ?? r.message.created_at).toLocaleString("he-IL")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EmployeeNewAnnouncementsCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["emp-dash-anns", userId],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data: anns, error: annsErr } = await supabase
        .from("announcements")
        .select("id, title, starts_at, ends_at, created_at, sender_id")
        .is("deleted_at", null)
        .neq("sender_id", userId)
        .lte("starts_at", nowIso)
        .order("starts_at", { ascending: false })
        .limit(10);
      if (annsErr) throw annsErr;
      const rows = ((anns ?? []) as any[]).filter((a) => !a.ends_at || a.ends_at > nowIso);
      if (!rows.length) return [];
      const { data: reads, error: readsErr } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .in(
          "announcement_id",
          rows.map((r) => r.id),
        )
        .eq("user_id", userId);
      if (readsErr) throw readsErr;
      const readSet = new Set((reads ?? []).map((r: any) => r.announcement_id));
      return rows.filter((r) => !readSet.has(r.id)).slice(0, 5);
    },
  });
  useEffect(() => {
    const invalidateAnnouncements = () => qc.invalidateQueries({ queryKey: ["emp-dash-anns", userId] });
    const ch = supabase
      .channel(`emp-dash-ann-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () =>
        invalidateAnnouncements(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "announcement_reads", filter: `user_id=eq.${userId}` },
        invalidateAnnouncements,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "announcement_targets" },
        invalidateAnnouncements,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);
  const items = q.data ?? [];
  const navigate = useNavigate();
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate({ to: "/communications", search: { tab: "announcements" } as any })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate({ to: "/communications", search: { tab: "announcements" } as any });
        }
      }}
      className="card-elevated p-4 cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30 transition-all"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-base flex items-center gap-2">
          📢 הכרזות חדשות
          {items.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold">
              {items.length}
            </span>
          )}
        </h2>
        <span className="text-sm text-primary">לכל ההכרזות ←</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין הכרזות חדשות.</p>
      ) : (
        <ul className="divide-y">
          {items.map((a: any) => (
            <li key={a.id} className="py-2 text-sm">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({
                    to: "/communications",
                    search: { tab: "announcements", ann: a.id } as any,
                  });
                }}
                className="text-right hover:underline font-medium block w-full"
              >
                {a.title}
              </button>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(a.starts_at ?? a.created_at).toLocaleString("he-IL")}
              </p>
            </li>
          ))}
        </ul>
      )}
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
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: "primary" | "success" | "muted" | "warning" | "danger";
  onClick?: () => void;
  badge?: number;
  pulse?: boolean;
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    muted: "bg-muted text-muted-foreground",
    warning: "bg-orange-500/10 text-orange-600",
    danger: "bg-destructive/20 text-destructive",
  }[tone];
  const cardClass =
    tone === "danger"
      ? "card-elevated p-5 cursor-pointer transition-colors bg-destructive/10 border-2 border-destructive ring-2 ring-destructive/40 hover:bg-destructive/15"
      : "card-elevated p-5 cursor-pointer hover:bg-accent/30 transition-colors";
  const inner = (
    <Card className={cardClass + (pulse ? " animate-pulse" : "")}>
      <div className="flex items-center justify-between">
        <div>
          <p className={"text-sm " + (tone === "danger" ? "text-destructive font-semibold" : "text-muted-foreground")}>{label}</p>
          <p className={"text-3xl font-bold mt-2 " + (tone === "danger" ? "text-destructive" : "")}>{value}</p>
        </div>
        <div className={`relative size-11 rounded-xl flex items-center justify-center ${toneClass}`}>
          <Icon className="size-5" />
          {!!badge && badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center shadow">
              {badge > 99 ? "99+" : badge}
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

function SchedulesStatsSection({ profile }: { profile: any }) {
  const navigate = useNavigate();
  const isMainAdmin = profile.roles.includes("main_admin");
  const isBranchMgr =
    profile.roles.includes("branch_manager") || profile.roles.includes("assistant_manager");
  const isDeptMgr = profile.roles.includes("department_manager");
  const qc = useQueryClient();
  const [approvedOpen, setApprovedOpen] = useState(false);
  const [notSubmittedOpen, setNotSubmittedOpen] = useState(false);
  const [shiftCell, setShiftCell] = useState<null | { day: string; shift: "morning" | "evening" | "off" }>(null);

  const permsQ = useQuery({
    queryKey: ["my-perms", profile.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_create_schedule, can_approve_schedule, can_publish_schedule")
        .eq("user_id", profile.id)
        .maybeSingle();
      return data ?? { can_create_schedule: false, can_approve_schedule: false, can_publish_schedule: false };
    },
  });
  const canApprove = isMainAdmin || !!permsQ.data?.can_approve_schedule;
  const canManagePrePublishSchedules =
    isMainAdmin ||
    isBranchMgr ||
    !!permsQ.data?.can_create_schedule ||
    !!permsQ.data?.can_approve_schedule ||
    !!permsQ.data?.can_publish_schedule;

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

  const scopeFilter = canManagePrePublishSchedules ? null : profile.department_id ?? null;

  const statsQ = useQuery({
    enabled: !!profile,
    queryKey: ["dashboard-schedules", profile.id, weekStart, canApprove, canManagePrePublishSchedules],
    queryFn: async () => {
      const [{ data: scheds }, { data: deptRows }] = await Promise.all([
        supabase.from("schedules").select("id, status, department_id, week_start, week_end, published_at, updated_at"),
        supabase.from("departments").select("id, name, is_active").eq("is_active", true).order("name"),
      ]);
      const all = (scheds ?? []) as {
        id: string;
        status: string;
        department_id: string;
        week_start: string;
        week_end: string;
        published_at: string | null;
        updated_at: string | null;
      }[];
      const scoped = canManagePrePublishSchedules
        ? all
        : isDeptMgr
        ? all.filter((s) => s.department_id === profile.department_id && s.status === "approved" && !!s.published_at)
        : all.filter((s) => s.department_id === profile.department_id && s.status === "approved" && !!s.published_at);
      const currentWeekScoped = scoped.filter((s) => s.week_start <= weekEnd && weekStart <= s.week_end);

      const pending = currentWeekScoped.filter((s) => s.status === "pending_approval").length;
      const approved = currentWeekScoped.filter((s) => s.status === "approved").length;

      // ALL pending schedules (across every week) for the approval alert.
      const pendingAllList = (canApprove
        ? all.filter((s) => s.status === "pending_approval")
        : []
      ).sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
      const pendingAll = pendingAllList.length;
      const pendingFirst = pendingAllList[0] ?? null;

      // Departments without a submitted schedule for the current week
      // (i.e., no schedule, or status is draft/rejected — not yet sent for approval).
      const allDepts = (deptRows ?? []) as { id: string; name: string }[];
      // Consider a department as "submitted" if it has any pending_approval/approved
      // schedule whose date range OVERLAPS the current week — not strict equality on
      // week_start (a schedule may legitimately start on a different Saturday and
      // still cover the current week).
      const submittedDeptIds = new Set(
        all
          .filter(
            (s) =>
              (s.status === "pending_approval" || s.status === "approved") &&
              s.week_start <= weekEnd &&
              weekStart <= s.week_end,
          )
          .map((s) => s.department_id),
      );
      const notSubmittedDepts = allDepts.filter((d) => !submittedDeptIds.has(d.id));

      // Weekly approved schedules covering the current week (overlap)
      const weekScheds = scoped.filter(
        (s) =>
          s.status === "approved" &&
          (canManagePrePublishSchedules || !!s.published_at) &&
          s.week_start <= weekEnd &&
          weekStart <= s.week_end,
      );
      const ids = weekScheds.map((s) => s.id);
      const weekCounts: Record<string, { morning: number; evening: number; off: number }> = {};
      const modifiedCells: Record<string, { morning: boolean; evening: boolean; off: boolean }> = {};
      for (const d of weekDays) {
        weekCounts[d] = { morning: 0, evening: 0, off: 0 };
        modifiedCells[d] = { morning: false, evening: false, off: false };
      }
      if (ids.length) {
        const { data: shifts } = await supabase
          .from("schedule_shifts")
          .select("shift, day_date, published_shift")
          .in("schedule_id", ids)
          .gte("day_date", weekStart)
          .lte("day_date", weekEnd);
        for (const s of (shifts ?? []) as { shift: string; day_date: string; published_shift: string | null }[]) {
          const b = weekCounts[s.day_date];
          if (b && (s.shift === "morning" || s.shift === "evening" || s.shift === "off")) {
            (b as any)[s.shift] += 1;
          }
          const m = modifiedCells[s.day_date];
          // Mark ONLY the actual updated cell (the new shift value) — never the
          // previous shift, and never the entire day/row.
          if (
            m &&
            s.published_shift != null &&
            (s.shift ?? null) !== (s.published_shift ?? null)
          ) {
            const cur = s.shift as "morning" | "evening" | "off" | null;
            if (cur === "morning" || cur === "evening" || cur === "off") m[cur] = true;
          }
        }
      }
      return {
        pending,
        pendingAll,
        pendingFirst,
        approved,
        weekCounts,
        hasAnyApproved: ids.length > 0,
        modifiedCells,
        notSubmittedCount: notSubmittedDepts.length,
        notSubmittedDepts,
      };


    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("dash-schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () =>
        {
          qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
          qc.invalidateQueries({ queryKey: ["dashboard-approved-list"] });
          qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_shifts" }, () =>
        {
          qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
          qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () =>
        qc.invalidateQueries({ queryKey: ["dashboard-schedules"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  if (statsQ.isLoading || !statsQ.data) return null;
  const s = statsQ.data;
  const goSchedules = () => navigate({ to: "/schedules" });
  const goPending = () => {
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

  const DAY_NAMES = ["שבת", "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];
  const heDate = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      numberingSystem: "latn",
      calendar: "gregory",
    }).format(d);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CalendarDays className="size-5 text-primary" />
          סידורי עבודה
        </h2>
        <Link to="/schedules" className="text-sm text-primary hover:underline">
          לסידורי העבודה ←
        </Link>
      </div>

      {(canManagePrePublishSchedules || isDeptMgr) && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="ממתינים לאישור"
            value={canApprove ? s.pendingAll : s.pending}
            icon={Clock}
            tone={canApprove && s.pendingAll > 0 ? "danger" : "warning"}
            badge={canApprove ? s.pendingAll : undefined}
            pulse={canApprove && s.pendingAll > 0}
            onClick={goPending}
          />
          <StatCard label="מאושרים" value={s.approved} icon={CheckCircle2} tone="success" onClick={() => setApprovedOpen(true)} />
          {isMainAdmin && (
            <StatCard
              label="מחלקות שלא שלחו סידור"
              value={s.notSubmittedCount}
              icon={Building2}
              tone="warning"
              onClick={() => setNotSubmittedOpen(true)}
            />
          )}
        </div>
      )}


      <Card className="card-elevated p-0 overflow-auto relative">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <p className="font-semibold text-sm">סיכום שבועי</p>
          <p className="text-xs text-muted-foreground">
            {heDate(weekStart)} – {heDate(weekEnd)}
          </p>
        </div>
        {!s.hasAnyApproved ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            אין סידור עבודה מאושר לשבוע הנוכחי.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-right p-3">יום</th>
                <th className="p-3 text-center bg-amber-50"><span className="inline-flex items-center gap-1"><Sun className="size-4" /> בוקר</span></th>
                <th className="p-3 text-center bg-sky-50"><span className="inline-flex items-center gap-1"><Moon className="size-4" /> ערב</span></th>
                <th className="p-3 text-center bg-emerald-50"><span className="inline-flex items-center gap-1"><Plane className="size-4" /> חופש</span></th>
              </tr>
            </thead>
            <tbody>
              {weekDays.map((d, i) => {
                const c = s.weekCounts[d];
                const m = s.modifiedCells?.[d];
                return (
                  <tr key={d} className="border-t">
                    <td className="p-3 font-medium">
                      <div>{DAY_NAMES[i]}</div>
                      <div className="text-xs text-muted-foreground">{heDate(d)}</div>
                    </td>
                    {(["morning", "evening", "off"] as const).map((sh) => {
                      const shiftBg =
                        sh === "morning" ? "bg-amber-50" : sh === "evening" ? "bg-sky-50" : "bg-emerald-50";
                      const isModified = !!m?.[sh];
                      return (
                        <td key={sh} className={`p-2 text-center ${shiftBg}`}>
                          <div className={`relative inline-block ${isModified ? "" : ""}`}>
                            <button
                              type="button"
                              onClick={() => setShiftCell({ day: d, shift: sh })}
                              className={`relative inline-flex min-w-12 px-3 py-1.5 rounded-md hover:bg-accent/40 font-semibold ${
                                isModified ? "ring-2 ring-orange-500 border border-orange-500" : ""
                              }`}
                            >
                              {c[sh]}
                              {isModified && (
                                <RefreshCw
                                  className="size-3 text-orange-600 absolute -top-1 -left-1 bg-background rounded-full p-0.5 box-content border border-orange-500"
                                  aria-label="עודכן לאחר פרסום"
                                />
                              )}
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>


      <ApprovedSchedulesDialog
        open={approvedOpen}
        onOpenChange={setApprovedOpen}
        scopeFilter={scopeFilter}
      />

      <Dialog open={notSubmittedOpen} onOpenChange={setNotSubmittedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>מחלקות שטרם שלחו סידור עבודה</DialogTitle>
          </DialogHeader>
          {s.notSubmittedDepts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              כל המחלקות שלחו סידור לשבוע הנוכחי.
            </p>
          ) : (
            <ul className="divide-y max-h-[60vh] overflow-auto">
              {s.notSubmittedDepts.map((d) => (
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

      <ShiftCellDialog
        cell={shiftCell}
        onOpenChange={(v) => !v && setShiftCell(null)}
        scopeFilter={scopeFilter}
      />
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

function ShiftCellDialog({
  cell,
  onOpenChange,
  scopeFilter,
}: {
  cell: { day: string; shift: "morning" | "evening" | "off" } | null;
  onOpenChange: (v: boolean) => void;
  scopeFilter: string | null;
}) {
  const open = cell !== null;
  const q = useQuery({
    enabled: open,
    queryKey: ["dashboard-shift-cell", cell?.day, cell?.shift, scopeFilter],
    queryFn: async () => {
      let sq = supabase
        .from("schedules")
        .select("id, department_id")
        .eq("status", "approved")
        .lte("week_start", cell!.day)
        .gte("week_end", cell!.day);
      if (scopeFilter) sq = sq.eq("department_id", scopeFilter);
      const { data: scheds } = await sq;
      const ids = (scheds ?? []).map((s: any) => s.id);
      if (!ids.length) return [];
      const { data: shifts } = await supabase
        .from("schedule_shifts")
        .select("employee_id")
        .in("schedule_id", ids)
        .eq("day_date", cell!.day)
        .eq("shift", cell!.shift);
      const empIds = Array.from(new Set((shifts ?? []).map((s: any) => s.employee_id)));
      if (!empIds.length) return [];
      const { data: emps } = await supabase
        .from("profiles")
        .select("id, full_name, department_id")
        .in("id", empIds)
        .order("full_name");
      const deptIds = Array.from(
        new Set((emps ?? []).map((e: any) => e.department_id).filter(Boolean)),
      );
      const { data: depts } = deptIds.length
        ? await supabase.from("departments").select("id, name").in("id", deptIds)
        : { data: [] as any[] };
      const dm: Record<string, string> = {};
      (depts ?? []).forEach((d: any) => (dm[d.id] = d.name));
      return (emps ?? []).map((e: any) => ({
        ...e,
        department_name: dm[e.department_id] ?? "—",
      }));
    },
  });

  const SHIFT_LABEL: Record<"morning" | "evening" | "off", string> = {
    morning: "בוקר",
    evening: "ערב",
    off: "חופש",
  };
  const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const title = cell
    ? `יום ${DAY_NAMES[new Date(cell.day + "T00:00:00Z").getUTCDay()]} — ${SHIFT_LABEL[cell.shift]}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            אין עובדים משובצים.
          </p>
        ) : (
          <ul className="divide-y max-h-[60vh] overflow-auto">
            {q.data.map((e: any) => (
              <li key={e.id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{e.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{e.department_name}</p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {SHIFT_LABEL[cell!.shift]}
                </Badge>
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
        .select("id, full_name, is_active, on_leave, avatar_url, department_id")
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
                      {emp.on_leave && (
                        <Badge variant="secondary" className="rounded-full text-xs">בחופש</Badge>
                      )}
                      {emp.is_active && !emp.on_leave && (
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
        .select("id, full_name, department_id, job_title, is_active, on_leave, avatar_url, departments(name)")
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
                  q.data.on_leave
                    ? "בחופש"
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select(
          "id, user_id, status, break_setting_id, approved_at_time, approval_decided_at, started_at, ends_at, completed_at, duration_minutes, approved_by",
        )
        .eq("user_id", userId)
        .in("status", ["approved", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as any;
      const { data: setting } = await supabase
        .from("break_settings")
        .select("name")
        .eq("id", row.break_setting_id)
        .maybeSingle();
      let approver: { full_name: string; role_label: string | null; job_title: string | null } | null = null;
      if (row.approved_by) {
        const { data: ap } = await (supabase as any).rpc("get_profiles_basic_info", {
          user_ids: [row.approved_by],
        });
        const rec = Array.isArray(ap) ? ap[0] : null;
        if (rec) approver = { full_name: rec.full_name, role_label: rec.role_label, job_title: rec.job_title };
      }
      return {
        ...row,
        setting_name: (setting as any)?.name ?? "הפסקה",
        approver,
      };
    },
  });



  useEffect(() => {
    const ch = supabase
      .channel(`my-break-rt-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_requests", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["my-active-break", userId] }),
      )
      .subscribe();
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(id);
    };
  }, [qc, userId]);

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
  const startsAtIso: string | null = r.started_at ?? r.approved_at_time ?? null;
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

function BreakShortcutCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [, setTick] = useState(0);

  const breakQ = useQuery({
    enabled: !!userId,
    queryKey: ["my-break-shortcut", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select(
          "id, status, break_setting_id, requested_at, approved_at_time, approval_decided_at, started_at, ends_at, duration_minutes, approved_by",
        )
        .eq("user_id", userId)
        .in("status", ["pending", "approved", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as any;
      const { data: setting } = await supabase
        .from("break_settings")
        .select("name")
        .eq("id", row.break_setting_id)
        .maybeSingle();
      let approver: { full_name: string; role_label: string | null; job_title: string | null } | null = null;
      if (row.approved_by) {
        const { data: ap } = await (supabase as any).rpc("get_profiles_basic_info", {
          user_ids: [row.approved_by],
        });
        const rec = Array.isArray(ap) ? ap[0] : null;
        if (rec) approver = { full_name: rec.full_name, role_label: rec.role_label, job_title: rec.job_title };
      }
      return { ...row, setting_name: (setting as any)?.name ?? "הפסקה", approver };
    },
  });


  useEffect(() => {
    const ch = supabase
      .channel(`my-break-shortcut-rt-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_requests", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["my-break-shortcut", userId] }),
      )
      .subscribe();
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(id);
    };
  }, [qc, userId]);

  const endMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("end_my_break", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("סומן: חזרת מההפסקה");
      qc.invalidateQueries({ queryKey: ["my-break-shortcut", userId] });
      qc.invalidateQueries({ queryKey: ["my-active-break", userId] });
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const goRequest = () => navigate({ to: "/breaks" });
  const r = breakQ.data;

  if (!r) {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={goRequest}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") goRequest(); }}
        className="card-elevated p-5 border-2 border-primary/30 bg-primary/5 cursor-pointer transition-colors hover:bg-primary/10"
      >
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Coffee className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base">הפסקה</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              בקש/י הפסקה במהירות, ללא מעבר לתפריט.
            </p>
          </div>
          <Button size="sm" className="gap-2 shrink-0" onClick={(e) => { e.stopPropagation(); goRequest(); }}>
            <Send className="size-4" />
            בקשת הפסקה
          </Button>
        </div>
      </Card>
    );
  }

  if (r.status === "pending") {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={goRequest}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") goRequest(); }}
        className="card-elevated p-5 border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 cursor-pointer transition-colors hover:brightness-[0.98]"
      >
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
              ☕ {r.setting_name} · {r.duration_minutes} דק׳ · שעה מבוקשת{" "}
              {r.requested_at ? fmtHM(r.requested_at) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              לא ניתן לשלוח בקשה נוספת עד לקבלת החלטה.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const now = Date.now();
  const isActive = r.status === "active";
  const startsAtIso: string | null = r.started_at ?? r.approved_at_time ?? null;
  const endsAtMs = r.ends_at
    ? new Date(r.ends_at).getTime()
    : startsAtIso
      ? new Date(startsAtIso).getTime() + (r.duration_minutes ?? 0) * 60000
      : null;
  const remainingMs = endsAtMs ? endsAtMs - now : 0;
  const overrunMs = endsAtMs && now > endsAtMs ? now - endsAtMs : 0;
  const overrun = isActive && overrunMs > 0;

  const tone = overrun
    ? { card: "border-red-500 bg-red-50 dark:bg-red-950/30", icon: "bg-red-500/10 text-red-600", timer: "text-red-600", label: "🔴 חריגה" }
    : isActive
      ? { card: "border-green-500 bg-green-50 dark:bg-green-950/30", icon: "bg-green-500/10 text-green-600", timer: "text-green-600", label: "🟢 בהפסקה" }
      : { card: "border-amber-500 bg-amber-50 dark:bg-amber-950/30", icon: "bg-amber-500/10 text-amber-600", timer: "text-amber-600", label: "🟡 אושרה · ממתינה להתחלה" };

  const bigTimer = overrun
    ? `+${fmtHMS(overrunMs)}`
    : endsAtMs ? fmtHMS(Math.max(0, remainingMs)) : "--:--";

  const canEnd = isActive;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={goRequest}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") goRequest(); }}
      className={"card-elevated p-5 border-2 cursor-pointer transition-colors hover:brightness-[0.98] " + tone.card}
    >
      <div className="flex items-start gap-3">
        <div className={"size-11 rounded-xl flex items-center justify-center shrink-0 " + tone.icon}>
          <Coffee className="size-6" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">הפסקה</h3>
            <Badge variant={overrun ? "destructive" : isActive ? "default" : "secondary"}>
              {tone.label}
            </Badge>
            <span className="text-sm text-muted-foreground">
              ☕ {r.setting_name} · {r.duration_minutes} דק׳
            </span>
          </div>

          <div className="flex flex-col items-center justify-center py-1 select-none">
            <div className={"font-mono font-bold tabular-nums text-4xl sm:text-5xl tracking-wider " + tone.timer}>
              {bigTimer}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {overrun ? "זמן חריגה — נא לחזור לעבודה" : isActive ? "זמן נותר להפסקה" : "הפסקה מאושרת — תתחיל בקרוב"}
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

          {canEnd && (
            <div className="pt-1" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                className="gap-2 w-full sm:w-auto"
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
  );
}


function OnBreakSection({ profile }: { profile: any }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isMainAdmin = profile.roles.includes("main_admin");
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logEmpFilter, setLogEmpFilter] = useState<string>("__all");
  const [logDeptFilter, setLogDeptFilter] = useState<string>("__all");
  const [logTypeFilter, setLogTypeFilter] = useState<string>("__all");
  const [logStatusFilter, setLogStatusFilter] = useState<string>("__all");
  const [logSort, setLogSort] = useState<"created" | "overrun" | "return">("created");

  const permQ = useQuery({
    enabled: !!profile.id && !isMainAdmin,
    queryKey: ["dash-can-manage-breaks", profile.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_breaks")
        .eq("user_id", profile.id)
        .maybeSingle();
      return !!(data as any)?.can_manage_breaks;
    },
  });
  const canSee = isMainAdmin || !!permQ.data;

  const onBreakQ = useQuery({
    enabled: canSee,
    queryKey: ["dashboard-on-break"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select(
          "id, user_id, department_id, break_setting_id, started_at, ends_at, approved_by, duration_minutes",
        )
        .eq("status", "active");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];
      const uids = Array.from(new Set(rows.flatMap((r) => [r.user_id, r.approved_by].filter(Boolean))));
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
        name: (pMap.get(r.user_id) as any)?.full_name ?? "—",
        job_title:
          (mMap.get(r.user_id) as any)?.job_title ??
          (pMap.get(r.user_id) as any)?.job_title ??
          null,
        role_label: (mMap.get(r.user_id) as any)?.role_label ?? null,
        department: dMap.get(r.department_id) ?? "—",
        type: sMap.get(r.break_setting_id) ?? "הפסקה",
        startedAt: r.started_at as string | null,
        endsAt: r.ends_at as string | null,
        approverName:
          r.approved_by ? (pMap.get(r.approved_by) as any)?.full_name ?? "—" : "—",
      }));
    },
  });

  const pendingCountQ = useQuery({
    enabled: canSee,
    queryKey: ["dashboard-pending-breaks"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("break_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Daily log: all break requests created today (Asia/Jerusalem)
  const dailyLogQ = useQuery({
    enabled: canSee,
    queryKey: ["dashboard-daily-breaks"],
    queryFn: async () => {
      const now = new Date();
      // Local Israel-day window. Use local midnight; Supabase will compare as UTC.
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from("break_requests")
        .select(
          "id, user_id, department_id, break_setting_id, created_at, requested_at, approved_at_time, approval_decided_at, started_at, ends_at, completed_at, status, approved_by, duration_minutes",
        )
        .gte("created_at", dayStart.toISOString())
        .lt("created_at", dayEnd.toISOString())
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];
      const uids = Array.from(
        new Set(rows.flatMap((r) => [r.user_id, r.approved_by].filter(Boolean))),
      );
      const dids = Array.from(new Set(rows.map((r) => r.department_id).filter(Boolean)));
      const sids = Array.from(new Set(rows.map((r) => r.break_setting_id).filter(Boolean)));
      const [{ data: profs }, { data: depts }, { data: settings }, { data: meta }] =
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
        ]);
      const pMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const dMap = new Map((depts ?? []).map((d: any) => [d.id, d.name]));
      const sMap = new Map((settings ?? []).map((s: any) => [s.id, s.name]));
      const mMap = new Map((meta ?? []).map((m: any) => [m.id, m]));
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
        startedAt: r.started_at as string | null,
        endsAt: r.ends_at as string | null,
        completedAt: r.completed_at as string | null,
        status: r.status as string,
        approverName: r.approved_by ? (pMap.get(r.approved_by) as any)?.full_name ?? "—" : "—",
      }));
    },
  });



  // Realtime + minute tick for countdown
  useEffect(() => {
    if (!canSee) return;
    const ch = supabase
      .channel("dash-on-break-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "break_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
        qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
        qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
      })
      .subscribe();
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
    }, 10_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [qc, canSee]);

  if (!canSee) return null;
  const list = onBreakQ.data ?? [];
  const log = dailyLogQ.data ?? [];

  const fmtT = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("he-IL", {
          timeZone: "Asia/Jerusalem",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(iso))
      : "—";

  const STATUS_LABEL: Record<string, string> = {
    pending: "ממתין לאישור",
    approved: "אושר · טרם יצא להפסקה",
    active: "נמצא בהפסקה",
    completed: "סיים את ההפסקה",
    cancelled: "בוטלה",
  };

  const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "secondary",
    approved: "outline",
    active: "default",
    completed: "secondary",
    cancelled: "destructive",
  };


  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="בקשות הפסקה ממתינות לאישור"
          value={pendingCountQ.data ?? 0}
          icon={Clock}
          tone={(pendingCountQ.data ?? 0) > 0 ? "danger" : "warning"}
          onClick={() => navigate({ to: "/breaks-admin" })}
          badge={pendingCountQ.data ?? 0}
          pulse={(pendingCountQ.data ?? 0) > 0}
        />
        <StatCard
          label="עובדים בהפסקה כעת"
          value={list.length}
          icon={Coffee}
          tone="primary"
          onClick={() => setOpen(true)}
        />
        <StatCard
          label="יומן הפסקות"
          value={log.length}
          icon={Coffee}
          tone="muted"
          onClick={() => setLogOpen(true)}
        />
        <Card
          className="card-elevated p-4 flex items-center justify-between cursor-pointer hover:bg-muted/40"
          onClick={() => navigate({ to: "/breaks-admin" })}
        >
          <div>
            <p className="text-xs text-muted-foreground">ניהול בקשות הפסקה</p>
            <p className="font-medium mt-1">פתח מסך הפסקות</p>
          </div>
          <Coffee className="size-5 text-primary" />
        </Card>
      </div>

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
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
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
                  <Select value={logDeptFilter} onValueChange={setLogDeptFilter}>
                    <SelectTrigger><SelectValue placeholder="מחלקה" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">כל המחלקות</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                          <th className="text-right p-2">🏬 מחלקה</th>
                          <th className="text-right p-2">☕ סוג</th>
                          <th className="text-right p-2">👤 אישר</th>
                          <th className="text-right p-2">🕒 התחלה</th>
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
                              <td className="p-2 whitespace-nowrap">{r.department}</td>
                              <td className="p-2 whitespace-nowrap">{r.type}</td>
                              <td className="p-2 whitespace-nowrap">{r.approverName}</td>
                              <td className="p-2 whitespace-nowrap">{fmtT(r.startedAt)}</td>
                              <td className="p-2 whitespace-nowrap">{fmtT(r.endsAt)}</td>
                              <td className="p-2 whitespace-nowrap">{fmtT(r.completedAt)}</td>
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




      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>עובדים בהפסקה כעת</DialogTitle>
          </DialogHeader>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              אין עובדים בהפסקה כרגע.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
              {list.map((r) => {
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
                        🏬 {r.department} · ☕ {r.type} · התחיל ב־{startStr} · 🕒 חזרה משוערת: {endStr}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        אישר/ה: {r.approverName}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {overrunMs > 0 ? (
                        <Badge variant="destructive">🔴 חריגה {overMin} דק׳</Badge>
                      ) : (
                        <Badge variant="secondary">⏳ נותר {remMin} דק׳</Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}



