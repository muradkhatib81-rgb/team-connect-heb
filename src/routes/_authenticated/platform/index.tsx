import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Crown,
  ShieldCheck,
  UserCheck,
  UserX,
  Activity,
  Settings,
  Building2,
  GitBranch,
  ArrowLeft,
  Loader2,
  Radio,
  CreditCard,
  Flag,
  BarChart3,
  Bell,
  AlertTriangle,
  Fingerprint,
} from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import {
  usePlatformOwnersQuery,
  usePlatformAuditQuery,
  usePlatformStats,
  getPlatformEventLabel,
} from "@/lib/platform-owners.hooks";
import { useCompanyContext } from "@/platform";
import { branchService } from "@/modules/branches";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/platform/")({
  component: PlatformDashboardPage,
  errorComponent: PlatformDashboardError,
  notFoundComponent: PlatformDashboardNotFound,
});

function PlatformDashboardError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? t("common.error")}
    </div>
  );
}

function PlatformDashboardNotFound() {
  const { t } = useTranslation();
  return <div className="p-6 text-sm text-muted-foreground">{t("platformHub.pageNotFound")}</div>;
}

function PlatformDashboardPage() {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const stats = usePlatformStats();
  const owners = usePlatformOwnersQuery();
  const audit = usePlatformAuditQuery();
  const { companies } = useCompanyContext();
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
            <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("platformHub.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {profile?.full_name
                ? t("platformHub.welcome", { name: profile.full_name })
                : t("platformHub.welcomeFallback")}
            </p>
          </div>
        </div>
      </header>

      {/* Stat cards (clickable navigation) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label={t("platformHub.stats.activeOwners")}
          value={stats.activeCount}
          icon={UserCheck}
          tone="emerald"
          loading={stats.isLoading}
          onClick={() => navigate({ to: "/platform/owners", search: { status: "active" } })}
        />
        <StatCard
          label={t("platformHub.stats.suspended")}
          value={stats.suspendedCount}
          icon={UserX}
          tone="rose"
          loading={stats.isLoading}
          onClick={() => navigate({ to: "/platform/owners", search: { status: "suspended" } })}
        />
        <StatCard
          label={t("platformHub.stats.primaryOwner")}
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
          label={t("platformHub.stats.auditEvents30d")}
          value={stats.events30d}
          icon={Activity}
          tone="sky"
          loading={stats.isLoading}
          onClick={() => navigate({ to: "/platform/audit-log" })}
        />
      </div>

      {/* Global Platform totals — never a specific Company/Branch's data.
          The Platform Dashboard is the root of the app; it never activates
          or reflects any single Branch (see requirements in this phase). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          label={t("platformHub.stats.companies")}
          value={companies.length}
          icon={Building2}
          tone="emerald"
          loading={false}
          onClick={() => navigate({ to: "/platform/companies" })}
        />
        <StatCard
          label={t("platformHub.stats.branches")}
          value={allBranchesQuery.data?.length ?? 0}
          icon={GitBranch}
          tone="sky"
          loading={allBranchesQuery.isLoading}
          onClick={() => navigate({ to: "/platform/branches" })}
        />
      </div>

      {/* Quick actions */}
      <Card className="card-elevated p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/owners">
              <Crown className="size-4" />
              {t("platformHub.quick.manageOwners")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/audit-log">
              <ShieldCheck className="size-4" />
              {t("platformHub.quick.auditLog")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/companies">
              <Building2 className="size-4" />
              {t("platformHub.quick.manageCompanies")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/platform/branches">
              <GitBranch className="size-4" />
              {t("platformHub.quick.manageBranches")}
            </Link>
          </Button>
        </div>
      </Card>

      {/* Latest activity */}
      <Card className="card-elevated">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            {t("platformHub.recentActivity")}
          </h2>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to="/platform/audit-log">
              {t("platformHub.fullLog")}
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        </div>
        {audit.isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : latestEvents.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">{t("platformHub.noRecentActivity")}</div>
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
                  <span className="font-medium">{getPlatformEventLabel(ev.event)}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {actor ? t("platformHub.actor", { name: actor }) : ""}
                    {target ? ` · ${t("platformHub.target", { name: target })}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Platform modules — the main operating center for a Platform Owner.
          Every tile here is a real, working module backed by the existing
          Foundation (Managers/Runtime); nothing is a placeholder. No
          branch-specific, company-specific or employee-specific data ever
          appears on this dashboard. */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">{t("platformHub.modulesSection")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ModuleTile
            icon={Building2}
            label={t("platformHub.modules.companies")}
            hint={t("platformHub.hints.companies", { count: companies.length })}
            onClick={() => navigate({ to: "/platform/companies" })}
          />
          <ModuleTile
            icon={GitBranch}
            label={t("platformHub.modules.branches")}
            hint={t("platformHub.hints.branches", { count: allBranchesQuery.data?.length ?? 0 })}
            onClick={() => navigate({ to: "/platform/branches" })}
          />
          <ModuleTile
            icon={Activity}
            label={t("platformHub.modules.monitoring")}
            hint="Health Checks"
            onClick={() => navigate({ to: "/platform/monitoring" })}
          />
          <ModuleTile
            icon={AlertTriangle}
            label={t("opsErrors.platformTitle")}
            hint={t("opsErrors.platformSubtitle")}
            onClick={() => navigate({ to: "/platform/control-log" })}
          />
          <ModuleTile
            icon={Fingerprint}
            label={t("attendance.platformTitle")}
            hint={t("attendance.platformSubtitle")}
            onClick={() => navigate({ to: "/platform/attendance" })}
          />
          <ModuleTile
            icon={Radio}
            label={t("platformHub.modules.realtime")}
            hint="Realtime Manager"
            onClick={() => navigate({ to: "/platform/realtime" })}
          />
          <ModuleTile
            icon={CreditCard}
            label={t("platformHub.modules.billing")}
            hint="Billing & Subscriptions"
            onClick={() => navigate({ to: "/platform/billing" })}
          />
          <ModuleTile
            icon={Flag}
            label={t("platformHub.modules.featureFlags")}
            hint="Feature Flags"
            onClick={() => navigate({ to: "/platform/feature-flags" })}
          />
          <ModuleTile
            icon={BarChart3}
            label={t("platformHub.modules.analytics")}
            hint="Global Analytics"
            onClick={() => navigate({ to: "/platform/analytics" })}
          />
          <ModuleTile
            icon={Crown}
            label={t("platformHub.modules.owners")}
            hint={t("platformHub.hints.owners", { count: stats.activeCount + stats.suspendedCount })}
            onClick={() => navigate({ to: "/platform/owners" })}
          />
          <ModuleTile
            icon={ShieldCheck}
            label={t("platformHub.modules.auditLog")}
            hint="Audit Log"
            onClick={() => navigate({ to: "/platform/audit-log" })}
          />
          <ModuleTile
            icon={Bell}
            label={t("platformHub.modules.notifications")}
            hint="Notification Manager"
            onClick={() => navigate({ to: "/platform/notifications" })}
          />
          <ModuleTile
            icon={Settings}
            label={t("platformHub.modules.settings")}
            hint="Platform Settings"
            onClick={() => navigate({ to: "/platform/settings" })}
          />
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

function ModuleTile({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Crown;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-right rounded-xl bg-card border card-elevated p-4 transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3">
        <div className="size-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{label}</p>
          <p className="text-xs text-muted-foreground truncate">{hint}</p>
        </div>
      </div>
    </button>
  );
}
