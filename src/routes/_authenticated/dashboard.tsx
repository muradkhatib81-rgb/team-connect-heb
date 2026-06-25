import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
import { Users, UserCheck, UserX, Building2, Loader2, Plane, ListTodo, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
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
            {DEPARTMENT_LABELS[profile.department]}
          </Badge>
          {!profile.is_active && (
            <Badge variant="destructive" className="rounded-full">לא פעיל</Badge>
          )}
        </div>
      </header>

      <TasksStatsSection stats={tasksStatsQuery.data} loading={tasksStatsQuery.isLoading} />

      {admin ? (
        <AdminDashboard stats={statsQuery.data} loading={statsQuery.isLoading} />
      ) : isDeptManager ? (
        <DeptManagerDashboard data={deptManagerQuery.data} loading={deptManagerQuery.isLoading} />
      ) : (
        <EmployeeDashboard />
      )}
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
}: {
  stats?: { total: number; active: number; inactive: number; onLeave: number; byDept: Record<string, number>; departments: DeptRow[] };
  loading: boolean;
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
