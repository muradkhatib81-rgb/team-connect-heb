import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Crown,
  ShieldCheck,
  UserCheck,
  UserX,
  Activity,
  Settings,
  Bot,
  Globe,
  Building2,
  GitBranch,
  Star,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import {
  usePlatformOwnersQuery,
  usePlatformAuditQuery,
  usePlatformStats,
  PLATFORM_EVENT_LABELS,
} from "@/lib/platform-owners.hooks";
import { useCompanyContext, useBranchContext } from "@/platform";
import { branchService } from "@/modules/branches";

export const Route = createFileRoute("/_authenticated/platform/")({
  component: PlatformDashboardPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? "שגיאה"}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">הדף לא נמצא</div>,
});

function PlatformDashboardPage() {
  const { data: profile } = useAuth();
  const stats = usePlatformStats();
  const owners = usePlatformOwnersQuery();
  const audit = usePlatformAuditQuery();
  const { companies, activeCompany } = useCompanyContext();
  const { activeBranch } = useBranchContext();
  const navigate = useNavigate();

  const allBranchesQuery = useQuery({
    queryKey: ["platform-all-branches"],
    queryFn: () => branchService.listAllBranches(),
  });

  const ownersById = new Map((owners.data ?? []).map((o) => [o.user_id, o]));

  const latestEvents = (audit.data ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 shrink-0 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Crown className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">ניהול פלטפורמה</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {profile?.full_name ? `ברוך הבא, ${profile.full_name}` : "מרכז הבקרה של הפלטפורמה"}
            </p>
          </div>
        </div>
      </header>

      {/* Stat cards (clickable navigation) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="בעלי מערכת פעילים"
          value={stats.activeCount}
          icon={UserCheck}
          tone="emerald"
          loading={stats.isLoading}
          onClick={() => navigate({ to: "/platform/owners", search: { status: "active" } })}
        />
        <StatCard
          label="מושעים"
          value={stats.suspendedCount}
          icon={UserX}
          tone="rose"
          loading={stats.isLoading}
          onClick={() => navigate({ to: "/platform/owners", search: { status: "suspended" } })}
        />
        <StatCard
          label="בעל מערכת ראשי"
          value={stats.primary?.full_name ?? "—"}
          icon={Crown}
          tone="amber"
          loading={stats.isLoading}
          onClick={() => {
            if (stats.primary) {
              navigate({
                to: "/platform/owners/$userId",
                params: { userId: stats.primary.user_id },
              });
            }
          }}
          disabled={!stats.primary}
        />
        <StatCard
          label="אירועי יומן (30 יום)"
          value={stats.events30d}
          icon={Activity}
          tone="sky"
          loading={stats.isLoading}
          onClick={() => navigate({ to: "/platform/audit-log" })}
        />
      </div>

      {/* Multi-tenant hierarchy: Companies -> Branches */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="חברות בפלטפורמה"
          value={companies.length}
          icon={Building2}
          tone="emerald"
          loading={false}
          onClick={() => navigate({ to: "/platform/companies" })}
        />
        <StatCard
          label="סניפים בפלטפורמה"
          value={allBranchesQuery.data?.length ?? 0}
          icon={GitBranch}
          tone="sky"
          loading={allBranchesQuery.isLoading}
          onClick={() => navigate({ to: "/platform/branches" })}
        />
        <StatCard
          label="חברה פעילה"
          value={activeCompany?.name ?? "—"}
          icon={Star}
          tone="amber"
          loading={false}
          onClick={() => {
            if (activeCompany) {
              navigate({
                to: "/platform/companies/$companyId",
                params: { companyId: activeCompany.id },
              });
            }
          }}
          disabled={!activeCompany}
        />
        <StatCard
          label="סניף פעיל"
          value={activeBranch?.name ?? "—"}
          icon={Star}
          tone="rose"
          loading={false}
          onClick={() => {
            if (activeBranch) {
              navigate({
                to: "/platform/branches/$branchId",
                params: { branchId: activeBranch.id },
              });
            }
          }}
          disabled={!activeBranch}
        />
      </div>

      {/* Quick actions */}
      <Card className="card-elevated p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/owners">
              <Crown className="size-4" />
              ניהול בעלי מערכת
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/audit-log">
              <ShieldCheck className="size-4" />
              יומן פעילות פלטפורמה
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/companies">
              <Building2 className="size-4" />
              ניהול חברות
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/branches">
              <GitBranch className="size-4" />
              ניהול סניפים
            </Link>
          </Button>
        </div>
      </Card>

      {/* Latest activity */}
      <Card className="card-elevated">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            פעילות אחרונה
          </h2>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to="/platform/audit-log">
              ליומן המלא
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        </div>
        {audit.isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : latestEvents.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">אין פעילות אחרונה</div>
        ) : (
          <ul className="divide-y">
            {latestEvents.map((ev) => {
              const actor = ev.actor_id ? ownersById.get(ev.actor_id)?.full_name : null;
              const target = ev.target_user_id
                ? ownersById.get(ev.target_user_id)?.full_name
                : null;
              return (
                <li key={ev.id} className="p-3 text-sm flex items-center gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-32">
                    {new Date(ev.created_at).toLocaleString("he-IL")}
                  </span>
                  <span className="font-medium">{PLATFORM_EVENT_LABELS[ev.event] ?? ev.event}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {actor ? `מבצע: ${actor}` : ""}
                    {target ? ` · יעד: ${target}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Platform modules */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">מודולי פלטפורמה</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/platform/companies" })}
            className="text-right rounded-xl bg-card border card-elevated p-4 transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-3">
              <div className="size-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">ניהול חברות</p>
                <p className="text-xs text-muted-foreground">{companies.length} חברות</p>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: "/platform/branches" })}
            className="text-right rounded-xl bg-card border card-elevated p-4 transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-3">
              <div className="size-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <GitBranch className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">ניהול סניפים</p>
                <p className="text-xs text-muted-foreground">
                  {allBranchesQuery.data?.length ?? 0} סניפים
                </p>
              </div>
            </div>
          </button>
          <ComingSoonTile icon={Settings} label="הגדרות פלטפורמה" />
          <ComingSoonTile icon={Bot} label="ניהול AI" />
          <ComingSoonTile icon={Globe} label="בינאום (i18n)" />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
  onClick,
  disabled,
}: {
  label: string;
  value: number | string;
  icon: typeof Crown;
  tone: "emerald" | "rose" | "amber" | "sky";
  loading: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-500",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-right rounded-xl bg-card border card-elevated p-4 transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl sm:text-2xl font-bold truncate mt-1">{loading ? "…" : value}</p>
        </div>
        <div
          className={`size-9 shrink-0 rounded-lg flex items-center justify-center ${tones[tone]}`}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </button>
  );
}

function ComingSoonTile({ icon: Icon, label }: { icon: typeof Crown; label: string }) {
  return (
    <Card className="p-4 opacity-70">
      <div className="flex items-center gap-3">
        <div className="size-9 shrink-0 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{label}</p>
          <Badge variant="secondary" className="mt-1 text-[10px] font-normal">
            בקרוב
          </Badge>
        </div>
      </div>
    </Card>
  );
}
