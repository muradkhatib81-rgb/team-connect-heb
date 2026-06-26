import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  ROLE_LABELS,
  DEPARTMENT_LABELS,
  highestRole,
  isAdmin,
} from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserCheck, UserX, Building2, Loader2, Plane, ListTodo, Clock, CheckCircle2, AlertTriangle, CalendarDays, Sun, Moon, User } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";

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
      const [{ data: profs, error: pErr }, { data: depts, error: dErr }] = await Promise.all([
        supabase.from("profiles").select("id, is_active, on_leave, department_id"),
        supabase.from("departments").select("id, name, is_active").order("name"),
      ]);
      if (pErr) throw pErr;
      if (dErr) throw dErr;
      const total = profs!.length;
      const onLeave = profs!.filter((d: any) => d.on_leave).length;
      const active = profs!.filter((d: any) => d.is_active && !d.on_leave).length;
      const inactive = profs!.filter((d: any) => !d.is_active).length;
      const byDept: Record<string, number> = {};
      (depts as DeptRow[]).forEach((d) => (byDept[d.id] = 0));
      profs!.forEach((p: any) => {
        if (p.department_id && byDept[p.department_id] !== undefined) {
          byDept[p.department_id] += 1;
        }
      });
      return { total, active, inactive, onLeave, byDept, departments: depts as DeptRow[] };
    },
  });

  // Department manager: always reload their department employees on mount
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
      const { data: emps, error: eErr } = await supabase
        .from("profiles")
        .select("id, full_name, phone, is_active, on_leave, avatar_url, department_id")
        .order("full_name");
      if (eErr) throw eErr;
      return { dept, employees: (emps ?? []) as DeptEmp[] };
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [admin, isDeptManager, profile, queryClient]);

  if (!profile) return null;
  const top = highestRole(profile.roles);

  return (
    <div className="space-y-8">
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

      <TasksStatsSection stats={tasksStatsQuery.data} loading={tasksStatsQuery.isLoading} />

      <SchedulesStatsSection profile={profile} />


      {admin ? (
        <AdminDashboard stats={statsQuery.data} loading={statsQuery.isLoading} onSelectDept={setDeptDialogId} />
      ) : isDeptManager ? (
        <DeptManagerDashboard data={deptManagerQuery.data} loading={deptManagerQuery.isLoading} />
      ) : (
        <EmployeeDashboard />
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
  phone: string | null;
  is_active: boolean;
  on_leave: boolean;
  avatar_url: string | null;
  department_id: string | null;
};

function DeptManagerDashboard({
  data,
  loading,
}: {
  data?: { dept: { id: string; name: string } | null; employees: DeptEmp[] };
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
        עדיין לא שויכת כאחראי מחלקה. פנה למנהל הראשי.
      </Card>
    );
  }
  const emps = data.employees.filter((e) => e.department_id === data.dept!.id);
  const total = emps.length;
  const active = emps.filter((e) => e.is_active && !e.on_leave).length;
  const onLeave = emps.filter((e) => e.on_leave).length;
  const inactive = emps.filter((e) => !e.is_active).length;
  const go = () =>
    navigate({ to: "/employees", search: { filter: "all", dept: data.dept!.id } as any });

  return (
    <>
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
                    {e.phone && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.phone}</p>
                    )}
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
}: {
  stats?: { total: number; active: number; inactive: number; onLeave: number; byDept: Record<string, number>; departments: DeptRow[] };
  loading: boolean;
  onSelectDept?: (id: string) => void;
}) {
  const navigate = useNavigate();
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
        <StatCard label="סך עובדים" value={stats.total} icon={Users} tone="primary" onClick={() => go("all")} />
        <StatCard label="עובדים פעילים" value={stats.active} icon={UserCheck} tone="success" onClick={() => go("active")} />
        <StatCard label="בחופש" value={stats.onLeave} icon={Plane} tone="warning" onClick={() => go("on_leave")} />
        <StatCard label="לא פעילים" value={stats.inactive} icon={UserX} tone="muted" onClick={() => go("inactive")} />
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
              <button
                key={d.id}
                type="button"
                onClick={() => goDept(d.id)}
                className="text-right"
              >
                <Card className="card-elevated p-4 cursor-pointer hover:bg-accent/30 transition-colors">
                  <p className="text-xs text-muted-foreground truncate">{d.name}</p>
                  <p className="text-2xl font-bold mt-1">{stats.byDept[d.id] ?? 0}</p>
                </Card>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function EmployeeDashboard() {
  return (
    <Card className="card-elevated p-6">
      <h2 className="font-semibold text-lg mb-2">ברוך הבא למערכת</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        כאן יוצגו בקרוב המשמרות, המשימות והעדכונים האישיים שלך.
        בשלב זה ניתן לעיין בפרטי הפרופיל האישי שלך דרך התפריט.
      </p>
    </Card>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: "primary" | "success" | "muted" | "warning";
  onClick?: () => void;
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    muted: "bg-muted text-muted-foreground",
    warning: "bg-orange-500/10 text-orange-600",
  }[tone];
  const inner = (
    <Card className="card-elevated p-5 cursor-pointer hover:bg-accent/30 transition-colors">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
        </div>
        <div className={`size-11 rounded-xl flex items-center justify-center ${toneClass}`}>
          <Icon className="size-5" />
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
  const [shiftCell, setShiftCell] = useState<null | { day: string; shift: "morning" | "evening" | "off" }>(null);

  const permsQ = useQuery({
    queryKey: ["my-perms", profile.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_create_schedule, can_approve_schedule")
        .eq("user_id", profile.id)
        .maybeSingle();
      return data ?? { can_create_schedule: false, can_approve_schedule: false };
    },
  });
  const canApprove = isMainAdmin || (isBranchMgr && !!permsQ.data?.can_approve_schedule);

  // Compute current week (Sunday-based) in Asia/Jerusalem-agnostic UTC slicing,
  // matching getWeekStart logic in schedules.tsx.
  const { weekStart, weekDays } = useMemo(() => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const start = d.toISOString().slice(0, 10);
    const days = Array.from({ length: 7 }, (_, i) => {
      const x = new Date(d);
      x.setUTCDate(d.getUTCDate() + i);
      return x.toISOString().slice(0, 10);
    });
    return { weekStart: start, weekDays: days };
  }, []);
  const weekEnd = weekDays[6];

  const scopeFilter = isMainAdmin || canApprove ? null : profile.department_id ?? null;

  const statsQ = useQuery({
    enabled: !!profile,
    queryKey: ["dashboard-schedules", profile.id, weekStart],
    queryFn: async () => {
      const { data: scheds } = await supabase
        .from("schedules")
        .select("id, status, department_id, week_start, week_end");
      const all = (scheds ?? []) as {
        id: string;
        status: string;
        department_id: string;
        week_start: string;
        week_end: string;
      }[];
      const scoped = isMainAdmin || canApprove
        ? all
        : isDeptMgr
        ? all.filter((s) => s.department_id === profile.department_id)
        : all.filter((s) => s.department_id === profile.department_id && s.status === "approved");

      const pending = scoped.filter((s) => s.status === "pending_approval").length;
      const approved = scoped.filter((s) => s.status === "approved").length;
      const rejected = scoped.filter((s) => s.status === "rejected").length;

      // Weekly approved schedules covering the current week (overlap)
      const weekScheds = scoped.filter(
        (s) => s.status === "approved" && s.week_start <= weekEnd && weekStart <= s.week_end,
      );
      const ids = weekScheds.map((s) => s.id);
      const weekCounts: Record<string, { morning: number; evening: number; off: number }> = {};
      for (const d of weekDays) weekCounts[d] = { morning: 0, evening: 0, off: 0 };
      if (ids.length) {
        const { data: shifts } = await supabase
          .from("schedule_shifts")
          .select("shift, day_date")
          .in("schedule_id", ids)
          .gte("day_date", weekStart)
          .lte("day_date", weekEnd);
        for (const s of (shifts ?? []) as { shift: string; day_date: string }[]) {
          const b = weekCounts[s.day_date];
          if (b && (s.shift === "morning" || s.shift === "evening" || s.shift === "off")) {
            (b as any)[s.shift] += 1;
          }
        }
      }
      return { pending, approved, rejected, weekCounts, hasAnyApproved: ids.length > 0 };
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("dash-schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () =>
        qc.invalidateQueries({ queryKey: ["dashboard-schedules"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_shifts" }, () =>
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
  const goPending = () => navigate({ to: "/schedules", search: { view: "pending" } as any });

  const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
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

      {(isMainAdmin || canApprove || isDeptMgr) && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="ממתינים לאישור" value={s.pending} icon={Clock} tone="warning" onClick={goPending} />
          <StatCard label="מאושרים" value={s.approved} icon={CheckCircle2} tone="success" onClick={() => setApprovedOpen(true)} />
          <StatCard label="נדחו" value={s.rejected} icon={AlertTriangle} tone="primary" onClick={goSchedules} />
        </div>
      )}

      <Card className="card-elevated p-0 overflow-auto">
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
                return (
                  <tr key={d} className="border-t">
                    <td className="p-3 font-medium">
                      <div>{DAY_NAMES[i]}</div>
                      <div className="text-xs text-muted-foreground">{heDate(d)}</div>
                    </td>
                    {(["morning", "evening", "off"] as const).map((sh) => {
                      const shiftBg =
                        sh === "morning" ? "bg-amber-50" : sh === "evening" ? "bg-sky-50" : "bg-emerald-50";
                      return (
                        <td key={sh} className={`p-2 text-center ${shiftBg}`}>
                          <button
                            type="button"
                            onClick={() => setShiftCell({ day: d, shift: sh })}
                            className="inline-flex min-w-12 px-3 py-1.5 rounded-md hover:bg-accent/40 font-semibold"
                          >
                            {c[sh]}
                          </button>
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
                    <p className="font-semibold">{r.department_name}</p>
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


