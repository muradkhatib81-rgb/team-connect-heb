import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  ROLE_LABELS,
  DEPARTMENT_LABELS,
  highestRole,
  isAdmin,
  DEPARTMENT_OPTIONS,
} from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserCheck, UserX, Building2, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: profile } = useAuth();
  const admin = profile ? isAdmin(profile.roles) : false;

  const statsQuery = useQuery({
    enabled: admin,
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, is_active, department");
      if (error) throw error;
      const total = data.length;
      const active = data.filter((d) => d.is_active).length;
      const inactive = total - active;
      const byDept: Record<string, number> = {};
      DEPARTMENT_OPTIONS.forEach((d) => (byDept[d] = 0));
      data.forEach((d) => (byDept[d.department] = (byDept[d.department] || 0) + 1));
      return { total, active, inactive, byDept };
    },
  });

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

      {admin ? (
        <AdminDashboard stats={statsQuery.data} loading={statsQuery.isLoading} />
      ) : (
        <EmployeeDashboard />
      )}
    </div>
  );
}

function AdminDashboard({
  stats,
  loading,
}: {
  stats?: { total: number; active: number; inactive: number; byDept: Record<string, number> };
  loading: boolean;
}) {
  if (loading || !stats) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="סך עובדים" value={stats.total} icon={Users} tone="primary" />
        <StatCard label="עובדים פעילים" value={stats.active} icon={UserCheck} tone="success" />
        <StatCard label="לא פעילים" value={stats.inactive} icon={UserX} tone="muted" />
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {DEPARTMENT_OPTIONS.map((d) => (
            <Card key={d} className="card-elevated p-4">
              <p className="text-xs text-muted-foreground">{DEPARTMENT_LABELS[d]}</p>
              <p className="text-2xl font-bold mt-1">{stats.byDept[d] ?? 0}</p>
            </Card>
          ))}
        </div>
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
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: "primary" | "success" | "muted";
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <Card className="card-elevated p-5">
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
}
