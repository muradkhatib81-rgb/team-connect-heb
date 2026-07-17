import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Building2,
  LogOut,
  Menu,
  X,
  Store,
  Loader2,
  ShieldCheck,
  UserCircle,
  ListTodo,
  CalendarDays,
  Coffee,
  Building,
  Megaphone,
  Trophy,
  Briefcase,
  Crown,
  UserCog,
  Settings,
  GitBranch,
  Activity,
  Radio,
  CreditCard,
  Flag,
  BarChart3,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useCompanySettings } from "@/lib/use-company-settings";
import {
  APP_NAME,
  ROLE_LABELS,
  isAdmin,
  canManageUsers,
  highestRole,
  isPlatformOwner as isPlatformOwnerRole,
} from "@/lib/constants";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "@/components/notifications-bell";
import { useActiveBranch } from "@/lib/use-active-branch";
import { AppFooter } from "@/components/app-footer";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  show: (roles: ReturnType<typeof highestRole> extends infer R ? any : never) => boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: profile, isLoading } = useAuth();
  const { data: company } = useCompanySettings();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Provided by <ActiveBranchProvider/> wrapping this component (see
  // routes/_authenticated/route.tsx) — the single real Branch Mode gate,
  // shared with the Platform's Company -> Branches flow. Used below to
  // decide whether branch-module nav items should even be listed.
  const { activeBranchId } = useActiveBranch();
  const inBranchMode = !!activeBranchId;

  const isMainAdminEarly = !!profile?.roles?.includes("main_admin");
  // Reuses the same role model as every other admin gate in this file
  // (profile.roles, via useAuth) instead of the separate Supabase-backed
  // Platform Owner server check — see src/lib/constants.ts.
  const isPlatformOwner = isPlatformOwnerRole(profile?.roles ?? []);

  const breakPermQ = useQuery({
    enabled: !!profile?.id && !isMainAdminEarly,
    queryKey: ["shell-can-manage-breaks", profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_breaks, can_manage_employee_of_month")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return {
        breaks: !!(data as any)?.can_manage_breaks,
        eom: !!(data as any)?.can_manage_employee_of_month,
      };
    },
  });

  // Unread messages count (announcements module removed)
  const commUnreadQ = useQuery({
    enabled: !!profile?.id,
    queryKey: ["shell-comm-unread", profile?.id],
    refetchInterval: 60_000,
    queryFn: async () => {
      const uid = profile!.id;
      const { count: msgCount } = await supabase
        .from("message_recipients")
        .select("message_id", { count: "exact", head: true })
        .eq("user_id", uid)
        .is("read_at", null)
        .is("archived_at", null);
      return msgCount ?? 0;
    },
  });

  useEffect(() => {
    if (!profile) return;
    if (profile.must_change_password && pathname !== "/change-password") {
      navigate({ to: "/change-password", replace: true });
      return;
    }
    // Plain employees may now access /dashboard directly (clean employee view).
  }, [profile?.must_change_password, profile, pathname, navigate]);

  // Realtime bridge and the Branch Mode gate read the active branch via
  // <ActiveBranchProvider/>, which now wraps this whole component (see
  // routes/_authenticated/route.tsx). See <RealtimeBridge/> and
  // <BranchModeGuard/> below.

  if (isLoading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const top = highestRole(profile.roles);
  const admin = isAdmin(profile.roles);
  const isDeptManager = profile.roles.includes("department_manager");
  // עובד רגיל = אין הרשאות ניהול ואינו אחראי מחלקה
  const isPlainEmployee = !admin && !isDeptManager;
  const isMainAdmin = isMainAdminEarly;
  const isSysAdmin = profile.roles.includes("system_admin");
  const isBranchManager = profile.roles.includes("branch_manager");

  // Managers of breaks: main admin, branch manager, or any user with the explicit permission.
  const isBreaksManager = isMainAdmin || isBranchManager || !!breakPermQ.data?.breaks;
  // Every user (including managers) can request their own break — managers are also employees.
  const canRequestBreak = true;
  const canManageEom = isMainAdmin || isBranchManager || !!breakPermQ.data?.eom;

  type NavEntry = {
    to: string;
    label: string;
    icon: typeof LayoutDashboard;
    visible: boolean;
    badge?: number;
    section?: string;
  };

  // Branch modules — only meaningful once an Active Branch exists. Regular
  // employees/managers are always inside their own branch already (their
  // `visible` flags are unchanged), so this list keeps working exactly as
  // before for them. For a Platform Owner, every one of these (besides the
  // personal profile) is unreachable until they explicitly enter Branch
  // Mode from the Platform (Company -> Branches -> a Branch) — see
  // <BranchModeGuard/> below, which enforces the very same rule at the
  // routing level. Tagged with a section header only for Platform Owners,
  // so a regular employee's nav looks exactly like it always has.
  const branchSection = isPlatformOwner ? "מודולי הסניף (במצב סניף)" : undefined;
  const branchItems: NavEntry[] = [
    {
      to: "/dashboard",
      label: "לוח ראשי",
      icon: LayoutDashboard,
      visible: true,
      section: branchSection,
    },
    { to: "/tasks", label: "משימות", icon: ListTodo, visible: true, section: branchSection },
    {
      to: "/schedules",
      label: "סידורי עבודה",
      icon: CalendarDays,
      visible: true,
      section: branchSection,
    },
    {
      to: "/communications",
      label: "מרכז תקשורת",
      icon: Megaphone,
      visible: true,
      badge: commUnreadQ.data ?? 0,
      section: branchSection,
    },
    {
      to: "/breaks",
      label: "הפסקה",
      icon: Coffee,
      visible: canRequestBreak,
      section: branchSection,
    },
    {
      to: "/breaks-admin",
      label: "ניהול הפסקות",
      icon: Coffee,
      visible: isBreaksManager,
      section: branchSection,
    },
    {
      to: "/employee-of-month",
      label: "עובד החודש",
      icon: Trophy,
      visible: canManageEom,
      section: branchSection,
    },

    {
      to: "/employees",
      label: "ניהול עובדים",
      icon: Users,
      visible: admin,
      section: branchSection,
    },
    {
      to: "/departments",
      label: "מחלקות",
      icon: Building2,
      visible: admin,
      section: branchSection,
    },
    {
      to: "/permissions",
      label: "הרשאות",
      icon: ShieldCheck,
      visible: canManageUsers(profile.roles),
      section: branchSection,
    },
    {
      to: "/shift-settings",
      label: "הגדרות משמרות",
      icon: CalendarDays,
      visible: admin,
      section: branchSection,
    },
    {
      to: "/job-titles",
      label: "תפקידים",
      icon: Briefcase,
      visible: isMainAdmin,
      section: branchSection,
    },
    {
      to: "/company-settings",
      label: "הגדרות חברה",
      icon: Building,
      visible: isMainAdmin,
      section: branchSection,
    },
    // Personal profile stays reachable regardless of Branch Mode.
    { to: "/profile", label: "הפרופיל שלי", icon: UserCircle, visible: isPlainEmployee },
  ];

  // ===== Platform Management — the primary home for Platform Owners. =====
  const platformItems: NavEntry[] = [
    {
      to: "/platform",
      label: "דשבורד פלטפורמה",
      icon: LayoutDashboard,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/companies",
      label: "חברות",
      icon: Building2,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/branches",
      label: "סניפי הפלטפורמה",
      icon: GitBranch,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/monitoring",
      label: "ניטור וזמינות",
      icon: Activity,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/realtime",
      label: "ניהול Real-Time",
      icon: Radio,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/billing",
      label: "חיוב ומנויים",
      icon: CreditCard,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/feature-flags",
      label: "דגלי פיצ'רים",
      icon: Flag,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/analytics",
      label: "אנליטיקס גלובלי",
      icon: BarChart3,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/owners",
      label: "בעלי מערכת",
      icon: Crown,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/audit-log",
      label: "יומן פעילות פלטפורמה",
      icon: ShieldCheck,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/notifications",
      label: "התראות פלטפורמה",
      icon: Bell,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
    {
      to: "/platform/settings",
      label: "הגדרות פלטפורמה",
      icon: Settings,
      visible: isPlatformOwner,
      section: "ניהול פלטפורמה",
    },
  ];

  // ===== System Administrator section (visible only to the singleton system_admin) =====
  const systemItems: NavEntry[] = [
    {
      to: "/system/branches",
      label: "סניפים",
      icon: Building2,
      visible: isSysAdmin,
      section: "ניהול מערכת",
    },
    {
      to: "/system/branch-managers",
      label: "מנהלי סניפים",
      icon: UserCog,
      visible: isSysAdmin,
      section: "ניהול מערכת",
    },
    {
      to: "/system/permissions",
      label: "הרשאות",
      icon: ShieldCheck,
      visible: isSysAdmin,
      section: "ניהול מערכת",
    },
    {
      to: "/system/settings",
      label: "הגדרות מערכת",
      icon: Settings,
      visible: isSysAdmin,
      section: "ניהול מערכת",
    },
  ];

  // A Platform Owner with no Active Branch has nothing to do in a Branch
  // module — hide the whole section instead of listing dead links (the
  // personal profile link is exempt, see `branchItems` above). Regular
  // employees/managers (never Platform Owners) are unaffected: `inBranchMode`
  // only gates this list for owners.
  const branchModulesLocked = isPlatformOwner && !inBranchMode;
  const visibleBranchItems = branchItems.filter(
    (item) => item.visible && !(branchModulesLocked && item.to !== "/profile"),
  );

  // Platform is the primary entry point for a Platform Owner, so its
  // section always renders first; Branch modules are secondary and only
  // appear once Branch Mode is actually entered. Regular employees never
  // see `platformItems`/`systemItems` (all `visible: false` for them), so
  // their nav is unchanged.
  const nav: NavEntry[] = [
    ...platformItems.filter((n) => n.visible),
    ...visibleBranchItems,
    ...systemItems.filter((n) => n.visible),
  ];

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("התנתקת מהמערכת");
    navigate({ to: "/auth", replace: true });
  }

  const SidebarContent = (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl gradient-brand flex items-center justify-center shadow-soft shrink-0 overflow-hidden">
            {company?.logo_url ? (
              <img
                src={company.logo_url}
                alt={company.company_name}
                className="size-full object-contain bg-white"
              />
            ) : (
              <Store className="size-5 text-primary-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">{APP_NAME}</p>
            <BranchSubtitle />
          </div>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
        {nav.map((item, idx) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const prev = idx > 0 ? nav[idx - 1] : null;
          const showSectionHeader = !!item.section && (!prev || prev.section !== item.section);
          return (
            <div key={item.to}>
              {showSectionHeader && (
                <div className="mt-4 mb-1 px-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Crown className="size-3" />
                  <span>{item.section}</span>
                </div>
              )}
              <Link
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {!!item.badge && item.badge > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-4 space-y-3 bg-sidebar">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-sm font-semibold shrink-0">
            {profile.full_name?.charAt(0) || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{profile.full_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {top ? ROLE_LABELS[top] : "—"}
              {profile.department_name ? ` · ${profile.department_name}` : ""}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setMobileOpen(false)}
          >
            <Link to="/profile">
              <UserCircle className="size-4" />
              פרופיל
            </Link>
          </Button>
          <Button onClick={handleSignOut} variant="outline" size="sm" className="gap-2">
            <LogOut className="size-4" />
            התנתקות
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <RealtimeBridge uid={profile.id} />
      <BranchModeGuard isPlatformOwner={isPlatformOwner} />
      <div className="flex flex-col min-h-screen bg-background">
        {/* Desktop sidebar (RTL: stick to right) */}
        <aside className="hidden lg:block fixed inset-y-0 right-0 w-64 border-l border-sidebar-border">
          {SidebarContent}
        </aside>

        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-background/95 backdrop-blur px-3 h-14">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="תפריט">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-72">
              {SidebarContent}
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {company?.logo_url ? (
              <img
                src={company.logo_url}
                alt={company?.company_name ?? APP_NAME}
                className="size-6 rounded object-contain shrink-0"
              />
            ) : (
              <Store className="size-5 text-primary shrink-0" />
            )}
            <div className="min-w-0 leading-tight">
              <span className="block font-semibold text-sm truncate">{APP_NAME}</span>
              <BranchSubtitle />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <NotificationsBell />
          </div>
        </header>

        {/* Floating header — desktop only */}
        <div className="hidden lg:flex fixed top-4 left-4 z-40 items-center gap-2">
          <div className="bg-background/95 backdrop-blur border rounded-full shadow-soft">
            <NotificationsBell />
          </div>
        </div>

        <main className="lg:mr-64 flex-1">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 lg:py-10">{children}</div>
          <AppFooter />
        </main>
      </div>
    </>
  );
}

/**
 * Rendered inside <AppShell/>, itself wrapped by <ActiveBranchProvider/>
 * (see routes/_authenticated/route.tsx), so it can read the active branch
 * via the context. Subscribes to every cross-cutting table once per
 * (user, active branch) pair and tears the channel down + rebuilds when
 * the sysadmin switches branches, so realtime stops emitting events
 * scoped to the previous branch through the open WebSocket.
 */
function RealtimeBridge({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();
  useEffect(() => {
    const ch = supabase
      .channel(`global-realtime-${uid}-${activeBranchId ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles" },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["all-roles"] });
          qc.invalidateQueries({ queryKey: ["permissions-list"] });
          const affected = payload?.new?.user_id ?? payload?.old?.user_id;
          if (!affected || affected === uid) {
            qc.invalidateQueries({ queryKey: ["auth", "me"] });
            qc.invalidateQueries({ queryKey: ["task-perm"] });
            qc.invalidateQueries({ queryKey: ["shell-can-manage-breaks"] });
          }
          qc.invalidateQueries({ queryKey: ["user-perms"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_task_permissions" },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["permissions-list"] });
          qc.invalidateQueries({ queryKey: ["user-perms"] });
          qc.invalidateQueries({ queryKey: ["task-perm"] });
          const affected = payload?.new?.user_id ?? payload?.old?.user_id;
          if (!affected || affected === uid) {
            qc.invalidateQueries({ queryKey: ["auth", "me"] });
            qc.invalidateQueries({ queryKey: ["shell-can-manage-breaks", uid] });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload: any) => {
          const affected = payload?.new?.id ?? payload?.old?.id;
          if (!affected || affected === uid) qc.invalidateQueries({ queryKey: ["auth", "me"] });
          qc.invalidateQueries({ queryKey: ["employees"] });
          qc.invalidateQueries({ queryKey: ["departments"] });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => {
        qc.invalidateQueries({ queryKey: ["auth", "me"] });
        qc.invalidateQueries({ queryKey: ["departments"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "job_titles" }, () => {
        qc.invalidateQueries({ queryKey: ["job-titles"] });
        qc.invalidateQueries({ queryKey: ["employees"] });
        qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_assignees" }, () =>
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "task_departments" }, () =>
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, () =>
        qc.invalidateQueries({ queryKey: ["task-activity"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "task_activity_log" }, () =>
        qc.invalidateQueries({ queryKey: ["task-activity"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => {
        qc.invalidateQueries({ queryKey: ["schedule"] });
        qc.invalidateQueries({ queryKey: ["schedules-pending"] });
        qc.invalidateQueries({ queryKey: ["schedules-approved"] });
        qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
        qc.invalidateQueries({ queryKey: ["dashboard-approved-list"] });
        qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_shifts" }, () => {
        qc.invalidateQueries({ queryKey: ["schedule-shifts"] });
        qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_definitions" }, () => {
        qc.invalidateQueries({ queryKey: ["shift-definitions"] });
        qc.invalidateQueries({ queryKey: ["shift-definitions-active"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "break_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["breaks"] });
        qc.invalidateQueries({ queryKey: ["breaks-admin"] });
        qc.invalidateQueries({ queryKey: ["dashboard-breaks"] });
        qc.invalidateQueries({ queryKey: ["break-stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "break_settings" }, () =>
        qc.invalidateQueries({ queryKey: ["break-settings"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["communications"] });
        qc.invalidateQueries({ queryKey: ["shell-comm-unread", uid] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_recipients" }, () => {
        qc.invalidateQueries({ queryKey: ["communications"] });
        qc.invalidateQueries({ queryKey: ["shell-comm-unread", uid] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "company_settings" }, () =>
        qc.invalidateQueries({ queryKey: ["company-settings"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_of_month" }, () =>
        qc.invalidateQueries({ queryKey: ["employee-of-month"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid, qc, activeBranchId]);
  return null;
}

// Branch modules (Dashboard, Employees, Departments, Schedule, Tasks,
// Messages, Settings, etc.) require an explicitly-selected active Branch.
// Everything under /platform, /system, /profile and /change-password is
// Platform/neutral territory and stays reachable without one.
const BRANCH_MODE_EXEMPT_PREFIXES = ["/platform", "/system", "/profile", "/change-password"];

function isBranchModuleRoute(pathname: string): boolean {
  return !BRANCH_MODE_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Rendered inside <AppShell/>, itself wrapped by <ActiveBranchProvider/>,
 * so it can read the active branch. Platform Owners (system_admin /
 * main_admin) must never be dropped into a Branch automatically (see
 * use-active-branch.tsx) — this guard makes sure every branch-module route
 * stays unreachable for them until they explicitly enter Branch Mode via
 * Company -> Branches -> a Branch (there is no global Branch switcher),
 * bouncing any direct navigation attempt back to the Platform Dashboard.
 */
function BranchModeGuard({ isPlatformOwner }: { isPlatformOwner: boolean }) {
  const { activeBranchId, isLoading } = useActiveBranch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPlatformOwner || isLoading || activeBranchId) return;
    if (!isBranchModuleRoute(pathname)) return;
    toast.info("יש לבחור סניף פעיל כדי להיכנס למודולים של הסניף");
    navigate({ to: "/platform", replace: true });
  }, [isPlatformOwner, isLoading, activeBranchId, pathname, navigate]);

  return null;
}

// Displays the currently active branch name (dynamic per logged-in user /
// sysadmin selection). Never displays a hardcoded company name.
function BranchSubtitle() {
  const { activeBranch } = useActiveBranch();
  const name = activeBranch?.name?.trim();
  if (!name) return null;
  const label = name.startsWith("סניף") ? name : `סניף ${name}`;
  return <p className="text-xs text-muted-foreground truncate">{label}</p>;
}
