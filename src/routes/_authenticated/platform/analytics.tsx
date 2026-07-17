import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, GitBranch, Users2, Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { usePlatformContext, useCompanyContext } from "@/platform";
import { branchService } from "@/modules/branches";

export const Route = createFileRoute("/_authenticated/platform/analytics")({
  component: PlatformAnalyticsPage,
});

function PlatformAnalyticsPage() {
  const { runtime } = usePlatformContext();
  const { companies, isLoading: companiesLoading } = useCompanyContext();

  const dashboardQuery = useQuery({
    queryKey: ["platform-analytics", "dashboard"],
    queryFn: () => runtime.getGlobalDashboard(),
  });

  const allBranchesQuery = useQuery({
    queryKey: ["platform-analytics", "all-branches"],
    queryFn: () => branchService.listAllBranches(),
  });

  const branches = allBranchesQuery.data ?? [];

  const branchesPerCompany = companies
    .map((company) => ({
      company,
      count: branches.filter((b) => b.companyId === company.id).length,
    }))
    .sort((a, b) => b.count - a.count);

  const oldestCompany = [...companies].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
  const newestCompany = [...companies].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <BarChart3 className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">אנליטיקס גלובלי</h1>
          <p className="text-sm text-muted-foreground mt-1">
            נתונים מצטברים על פני כל הפלטפורמה — חברות, סניפים ומשתמשים פעילים
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={Building2} label="חברות" value={dashboardQuery.data?.companiesCount ?? 0} />
        <StatCard icon={GitBranch} label="סניפים" value={dashboardQuery.data?.branchesCount ?? 0} />
        <StatCard
          icon={Users2}
          label="משתמשים עם session פעיל"
          value={dashboardQuery.data?.activeUserCount ?? 0}
        />
        <StatCard
          icon={Calendar}
          label="ממוצע סניפים לחברה"
          value={companies.length > 0 ? (branches.length / companies.length).toFixed(1) : "0"}
        />
      </div>

      <Card className="card-elevated overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground">חברות לפי מספר סניפים</h2>
        </div>
        {companiesLoading || allBranchesQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">טוען…</div>
        ) : branchesPerCompany.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין עדיין חברות בפלטפורמה
          </div>
        ) : (
          <ul className="divide-y">
            {branchesPerCompany.map(({ company, count }) => (
              <li key={company.id} className="flex items-center justify-between gap-3 p-3">
                <span className="truncate text-sm font-medium">{company.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {count} סניפים
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="card-elevated p-5 space-y-1">
          <p className="text-xs text-muted-foreground">החברה הוותיקה ביותר בפלטפורמה</p>
          <p className="text-lg font-bold truncate">{oldestCompany?.name ?? "—"}</p>
        </Card>
        <Card className="card-elevated p-5 space-y-1">
          <p className="text-xs text-muted-foreground">החברה החדשה ביותר בפלטפורמה</p>
          <p className="text-lg font-bold truncate">{newestCompany?.name ?? "—"}</p>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BarChart3;
  label: string;
  value: number | string;
}) {
  return (
    <Card className="card-elevated p-4 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold truncate">{value}</p>
    </Card>
  );
}
