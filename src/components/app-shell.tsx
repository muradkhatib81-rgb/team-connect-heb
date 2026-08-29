import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  Palmtree,
  Package,
  ClipboardList,
  ChevronDown,
  Sparkles,
  AlertTriangle,
  Fingerprint,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AuthProfile } from "@/lib/use-auth";
import { useCompanySettings } from "@/lib/use-company-settings";
import {
  getRoleLabel,
  isAdmin,
  highestRole,
  isPlatformOwner as isPlatformOwnerRole,
} from "@/lib/constants";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { getGuestLanguage, getSavedLanguage, saveLanguage } from "@/i18n";
import { htmlLangAttribute } from "@/lib/app-locale";
import { useServerFn } from "@tanstack/react-start";
import { syncPreferredLanguage } from "@/lib/translate-content.functions";
import { OnlinePresencePublisher } from "@/components/online-presence-publisher";
import { NotificationsBell } from "@/components/notifications-bell";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useBreakSelfServiceNavVisible } from "@/lib/use-shift-self-service-visible";
import { useCanManageBreaks, canManageBreaksQueryKey } from "@/lib/break-permissions";
import { useLeaveAccess } from "@/lib/leave-permissions";
import { AppFooter } from "@/components/app-footer";
import { useBranchContext, useCompanyContext } from "@/platform";
import { clearIdleSessionState, useIdleLogout } from "@/lib/use-idle-logout";
import {
  hasBranchActionPermission,
  useCurrentPermissions,
} from "@/lib/use-current-permissions";
import { fetchCustodyUserCaps, invalidateCustodyQueries } from "@/lib/custody-workflow";
import { invalidateShiftVisibleQueries } from "@/lib/shift-visible-rpc";
import { notifyOwnBreakStatusTransition } from "@/lib/break-self-realtime";
import {
  bridgeMonitorName,
  bridgePostgresOn,
  bridgeSupabaseChannelName,
  createBridgeChannel,
  notifyBridgeOperationalActivity,
  syncBridgeMonitorClose,
  syncBridgeMonitorOpen,
  syncBridgeSupabaseStatus,
} from "@/lib/realtime-bridge-sync";
import { useAiAccess } from "@/lib/use-ai-access";
import { bindPushToneListener } from "@/lib/alert-tone";
import { getAttendanceCapabilities } from "@/lib/attendance.functions";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  show: (roles: ReturnType<typeof highestRole> extends infer R ? any : never) => boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const syncLangFn = useServerFn(syncPreferredLanguage);
  const { data: profile, isLoading } = useAuth();
  const { data: company } = useCompanySettings();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search });
  // Provided by <ActiveBranchProvider/> wrapping this component (see
  // routes/_authenticated/route.tsx) — the single real Branch Mode gate,
  // shared with the Platform's Company -> Branches flow. Used below to
  // decide whether branch-module nav items should even be listed.
  const { activeBranchId } = useActiveBranch();
  const { activeCompany, activeCompanyId, setActiveCompanyId } = useCompanyContext();
  const { activeBranch, setActiveBranchId } = useBranchContext();
  // Prefer the Platform company name over branch-scoped company_settings so
  // branding never shows a store/branch string as the company.
  const brandName =
    activeCompany?.name?.trim() || company?.company_name?.trim() || t("common.appName");
  // The Platform Branch assignment is authoritative for navigation. The
  // lower-level real branch id alone is insufficient while Company Mode is
  // changing, because it can briefly represent the previous Company.
  const inBranchMode = !!activeBranch && activeBranch.companyId === activeCompanyId;

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

  const attendanceCapsFn = useServerFn(getAttendanceCapabilities);
  const attendanceBranchId = activeBranchId ?? profile?.branch_id ?? null;
  const attendanceCapsQ = useQuery({
    enabled: !!attendanceBranchId,
    queryKey: ["attendance-caps", attendanceBranchId],
    staleTime: 60_000,
    queryFn: () => attendanceCapsFn({ data: { branchId: attendanceBranchId! } }),
  });
  const showAttendanceNav =
    !!attendanceCapsQ.data?.show_employee_card || !!attendanceCapsQ.data?.show_manager_card;

  // Unread messages count (announcements module removed)
  const commUnreadQ = useQuery({
    enabled: !!profile?.id,
    queryKey: ["shell-comm-unread", profile?.id],
    staleTime: 60_000,
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
    if (!profile.is_active) {
      navigate({ to: "/inactive", replace: true });
      return;
    }
    if (profile.must_change_password && pathname !== "/change-password") {
      navigate({ to: "/change-password", replace: true });
      return;
    }
    // Plain employees may now access /dashboard directly (clean employee view).
  }, [profile?.is_active, profile?.must_change_password, profile, pathname, navigate]);

  // Apply guest/profile language once per user. Later picks belong to LanguageSwitcher;
  // re-applying the cached profile language here was reverting the UI until refresh.
  const appliedLangForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!profile?.id) {
      appliedLangForUser.current = null;
      return;
    }
    if (appliedLangForUser.current === profile.id) return;

    const guestLang = getGuestLanguage();
    const lang = guestLang ?? profile.preferred_language ?? getSavedLanguage(profile.id);
    appliedLangForUser.current = profile.id;
    saveLanguage(lang, profile.id);
    saveLanguage(lang);
    if (i18n.language !== lang) {
      void i18n.changeLanguage(lang);
      document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
      document.documentElement.lang = htmlLangAttribute(lang);
      document.body.lang = htmlLangAttribute(lang);
    }
    if (guestLang && guestLang !== profile.preferred_language) {
      qc.setQueryData<AuthProfile | null>(["auth", "me"], (prev) =>
        prev ? { ...prev, preferred_language: guestLang } : prev,
      );
      void syncLangFn({ data: { lang: guestLang } }).catch(() => {});
    }
  }, [profile?.id, profile?.preferred_language, i18n, syncLangFn, qc]);

  const breakSelfServiceNav = useBreakSelfServiceNavVisible();
  const { canManageBreaks } = useCanManageBreaks();
  const leaveAccess = useLeaveAccess();
  const aiAccessQ = useAiAccess();
  const permissionsQ = useCurrentPermissions(profile?.id);
  const custodyCapsQ = useQuery({
    enabled: !!profile?.id,
    queryKey: ["custody-caps", profile?.id],
    queryFn: () => fetchCustodyUserCaps(profile!.id),
    staleTime: 60_000,
  });

  // Realtime bridge and the Branch Mode gate read the active branch via
  // <ActiveBranchProvider/>, which now wraps this whole component (see
  // routes/_authenticated/route.tsx). See <RealtimeBridge/> and
  // <BranchModeGuard/> below.

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!profile) {
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
  const isBranchManager = profile.roles.includes("branch_manager");

  // Managers of breaks: main admin, branch manager, or any user with the explicit permission.
  const isBreaksManager = canManageBreaks;
  const canRequestBreak = breakSelfServiceNav.isVisible;
  const canManageEom = isPlatformOwner || isBranchManager || !!breakPermQ.data?.eom;
  const canManagePermissions = hasBranchActionPermission(
    profile.roles,
    permissionsQ.data,
    "can_manage_permissions",
  );
  const canManageCompanySettings =
    isPlatformOwner ||
    (profile.roles.includes("assistant_manager") &&
      permissionsQ.data?.can_manage_company_settings === true);
  const canManageShiftSettings = hasBranchActionPermission(
    profile.roles,
    permissionsQ.data,
    "can_manage_schedule",
  );

  type NavEntry = {
    to: string;
    label: string;
    icon: typeof LayoutDashboard;
    visible: boolean;
    badge?: number;
    section?: string;
    active?: boolean;
    onSelect?: () => void;
    children?: NavEntry[];
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
  const branchSection = isPlatformOwner ? activeBranch?.name : undefined;
  const canOpenCustodySettings = !!custodyCapsQ.data?.canOpenSettings;
  const canAccessCustodyLog = !!custodyCapsQ.data?.canAccessCustodyLog;
  const showCustodyNav = canOpenCustodySettings || canAccessCustodyLog;

  const branchItems: NavEntry[] = [
    {
      to: "/dashboard",
      label: t("nav.dashboard"),
      icon: LayoutDashboard,
      visible: true,
      section: branchSection,
    },
    { to: "/tasks", label: t("nav.tasks"), icon: ListTodo, visible: true, section: branchSection },
    {
      to: "/schedules",
      label: t("nav.schedules"),
      icon: CalendarDays,
      visible: true,
      section: branchSection,
    },
    {
      to: "/communications",
      label: t("nav.communications"),
      icon: Megaphone,
      visible: true,
      badge: commUnreadQ.data ?? 0,
      section: branchSection,
    },
    {
      to: "/breaks",
      label: t("nav.breaks"),
      icon: Coffee,
      visible: canRequestBreak,
      section: branchSection,
    },
    {
      to: "/break-planning",
      label: t("nav.breakPlanning"),
      icon: CalendarDays,
      visible: canRequestBreak,
      section: branchSection,
    },
    {
      to: "/breaks-admin",
      label: t("nav.breaksAdmin"),
      icon: Coffee,
      visible: isBreaksManager,
      section: branchSection,
    },
    {
      to: "/leaves",
      label: t("nav.leaves"),
      icon: Palmtree,
      visible: leaveAccess.canOpenLeavesPage,
      section: branchSection,
    },
    {
      to: "/leaves-admin",
      label: t("nav.leavesAdmin"),
      icon: Palmtree,
      visible: leaveAccess.canOpenLeaveAdmin,
      section: branchSection,
    },
    {
      to: "/attendance",
      label: t("nav.attendance"),
      icon: Fingerprint,
      visible: showAttendanceNav,
      section: branchSection,
    },
    {
      to: "/ai-assistant",
      label: t("nav.aiAssistant"),
      icon: Sparkles,
      visible: !!aiAccessQ.data?.allowed,
      section: branchSection,
    },
    {
      to: canOpenCustodySettings ? "/custody-settings" : "/custody-log",
      label: t("nav.custodySystem"),
      icon: Package,
      visible: showCustodyNav,
      section: branchSection,
      children: [
        {
          to: "/custody-log",
          label: t("nav.custodyLog"),
          icon: ClipboardList,
          visible: canAccessCustodyLog,
          section: branchSection,
        },
      ],
    },
    {
      to: "/employee-of-month",
      label: t("nav.employeeOfMonth"),
      icon: Trophy,
      visible: canManageEom,
      section: branchSection,
    },

    {
      to: "/employees",
      label: isDeptManager && !admin ? t("nav.deptEmployees") : t("nav.employees"),
      icon: Users,
      visible: admin || isDeptManager,
      section: branchSection,
    },
    {
      to: "/departments",
      label: t("nav.departments"),
      icon: Building2,
      visible: admin,
      section: branchSection,
    },
    {
      to: "/permissions",
      label: t("nav.permissions"),
      icon: ShieldCheck,
      visible: canManagePermissions,
      section: branchSection,
    },
    {
      to: "/shift-settings",
      label: t("nav.shiftSettings"),
      icon: CalendarDays,
      visible: canManageShiftSettings,
      section: branchSection,
    },
    {
      to: "/job-titles",
      label: t("nav.jobTitles"),
      icon: Briefcase,
      visible: isMainAdmin,
      section: branchSection,
    },
    {
      to: "/company-settings",
      label: t("nav.companySettings"),
      icon: Building,
      visible: canManageCompanySettings,
      section: branchSection,
    },
    // Personal profile stays reachable regardless of Branch Mode.
    { to: "/profile", label: t("nav.profile"), icon: UserCircle, visible: isPlainEmployee },
  ];

  // ===== Platform Management — hidden only while actively operating a Branch. =====
  const platformItems: NavEntry[] = [
    {
      to: "/platform/companies",
      label: t("nav.companies"),
      icon: Building2,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/branches",
      label: t("nav.platformBranches"),
      icon: GitBranch,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/control-log",
      label: t("nav.opsErrors"),
      icon: AlertTriangle,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/attendance",
      label: t("nav.attendance"),
      icon: Fingerprint,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/monitoring",
      label: t("nav.monitoring"),
      icon: Activity,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/realtime",
      label: t("nav.realtime"),
      icon: Radio,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/billing",
      label: t("nav.billing"),
      icon: CreditCard,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/ai-assistant",
      label: t("nav.aiAssistant"),
      icon: Sparkles,
      visible: isPlatformOwner && !!aiAccessQ.data?.allowed,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/ai",
      label: t("nav.platformAi"),
      icon: Sparkles,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/feature-flags",
      label: t("nav.featureFlags"),
      icon: Flag,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/analytics",
      label: t("nav.analytics"),
      icon: BarChart3,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/owners",
      label: t("nav.platformOwners"),
      icon: Crown,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/audit-log",
      label: t("nav.activityLog"),
      icon: ShieldCheck,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/notifications",
      label: t("nav.platformNotifications"),
      icon: Bell,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
    {
      to: "/platform/settings",
      label: t("nav.platformSettings"),
      icon: Settings,
      visible: isPlatformOwner,
      section: t("nav.platformSection"),
    },
  ];

  // Company tools belong only to the selected Company's section. They reuse
  // the existing Company dashboard tabs instead of creating parallel routes.
  const companyItems: NavEntry[] =
    isPlatformOwner && activeCompany && !inBranchMode
      ? [
          {
            to: "/platform/companies/$companyId",
            label: t("nav.companyDashboard"),
            icon: LayoutDashboard,
            visible: true,
            section: activeCompany.name,
            active:
              pathname === `/platform/companies/${activeCompany.id}` && search.tab === "dashboard",
            onSelect: () =>
              navigate({
                to: "/platform/companies/$companyId",
                params: { companyId: activeCompany.id },
                search: { tab: "dashboard" },
              }),
          },
          {
            to: "/platform/companies/$companyId",
            label: t("nav.branches"),
            icon: GitBranch,
            visible: true,
            section: activeCompany.name,
            active:
              pathname === `/platform/companies/${activeCompany.id}` && search.tab === "branches",
            onSelect: () =>
              navigate({
                to: "/platform/companies/$companyId",
                params: { companyId: activeCompany.id },
                search: { tab: "branches" },
              }),
          },
          {
            to: "/platform/companies/$companyId",
            label: t("nav.companyManagers"),
            icon: UserCog,
            visible: true,
            section: activeCompany.name,
            active:
              pathname === `/platform/companies/${activeCompany.id}` && search.tab === "managers",
            onSelect: () =>
              navigate({
                to: "/platform/companies/$companyId",
                params: { companyId: activeCompany.id },
                search: { tab: "managers" },
              }),
          },
          {
            to: "/platform/companies/$companyId",
            label: t("nav.companyUsers"),
            icon: Users,
            visible: true,
            section: activeCompany.name,
            active:
              pathname === `/platform/companies/${activeCompany.id}` && search.tab === "users",
            onSelect: () =>
              navigate({
                to: "/platform/companies/$companyId",
                params: { companyId: activeCompany.id },
                search: { tab: "users" },
              }),
          },
          {
            to: "/platform/companies/$companyId",
            label: t("nav.companyReports"),
            icon: BarChart3,
            visible: true,
            section: activeCompany.name,
            active:
              pathname === `/platform/companies/${activeCompany.id}` && search.tab === "reports",
            onSelect: () =>
              navigate({
                to: "/platform/companies/$companyId",
                params: { companyId: activeCompany.id },
                search: { tab: "reports" },
              }),
          },
          {
            to: "/platform/companies/$companyId",
            label: t("nav.companySettingsTab"),
            icon: Settings,
            visible: true,
            section: activeCompany.name,
            active:
              pathname === `/platform/companies/${activeCompany.id}` && search.tab === "settings",
            onSelect: () =>
              navigate({
                to: "/platform/companies/$companyId",
                params: { companyId: activeCompany.id },
                search: { tab: "settings" },
              }),
          },
        ]
      : [];

  // A Platform Owner with no Active Branch has nothing to do in a Branch
  // module — hide the whole section instead of listing dead links (the
  // personal profile link is exempt, see `branchItems` above). Regular
  // employees/managers (never Platform Owners) are unaffected: `inBranchMode`
  // only gates this list for owners.
  const branchModulesLocked = isPlatformOwner && !inBranchMode;
  const visibleBranchItems = branchItems.filter(
    (item) =>
      item.visible &&
      !(branchModulesLocked && item.to !== "/profile") &&
      !(isPlatformOwner && item.to === "/company-settings"),
  );

  // Platform is the primary entry point for a Platform Owner, so its
  // section always renders first; Branch modules are secondary and only
  // appear once Branch Mode is actually entered. Regular employees never
  // see `platformItems`/`systemItems` (all `visible: false` for them), so
  // their nav is unchanged.
  const nav: NavEntry[] = [
    ...platformItems.filter((n) => n.visible && !inBranchMode),
    ...companyItems,
    ...visibleBranchItems.filter(
      (item) => !isPlatformOwner || inBranchMode || item.to === "/profile",
    ),
  ];

  const handlePlatformHome = () => {
    setActiveBranchId(null);
    setActiveCompanyId(null);
    setMobileOpen(false);
    navigate({ to: "/platform" });
  };

  async function handleSignOut() {
    clearIdleSessionState();
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success(t("auth.loggedOut"));
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
                alt={brandName}
                className="size-full object-contain bg-white"
              />
            ) : (
              <Store className="size-5 text-primary-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">{t("common.appName")}</p>
            <BranchSubtitle />
          </div>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
        {isPlatformOwner && (
          <button
            type="button"
            onClick={handlePlatformHome}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === "/platform"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <LayoutDashboard className="size-4 shrink-0" />
            <span className="flex-1 text-start">{t("nav.dashboard")}</span>
          </button>
        )}
        {isPlatformOwner && inBranchMode && activeCompany && (
          <div className="mt-4 mb-1 px-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Building2 className="size-3" />
            <span>{activeCompany.name}</span>
          </div>
        )}
        {nav.map((item, idx) => {
          const visibleChildren = (item.children ?? []).filter((c) => c.visible);
          const childActive = visibleChildren.some(
            (c) => pathname === c.to || pathname.startsWith(`${c.to}/`),
          );
          const active =
            item.active ??
            (pathname === item.to || pathname.startsWith(`${item.to}/`) || childActive);
          const prev = idx > 0 ? nav[idx - 1] : null;
          const showSectionHeader = !!item.section && (!prev || prev.section !== item.section);
          const className = cn(
            "flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/60",
          );
          return (
            <div key={`${item.to}-${item.label}`}>
              {showSectionHeader && (
                <div className="mt-4 mb-1 px-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Crown className="size-3" />
                  <span>{item.section}</span>
                </div>
              )}
              {item.onSelect ? (
                <button
                  type="button"
                  onClick={() => {
                    item.onSelect?.();
                    setMobileOpen(false);
                  }}
                  className={className}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span className="flex-1 text-right">{item.label}</span>
                  {!!item.badge && item.badge > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </button>
              ) : (
                <Link to={item.to} onClick={() => setMobileOpen(false)} className={className}>
                  <item.icon className="size-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {visibleChildren.length > 0 ? (
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 opacity-70 transition-transform",
                        childActive || active ? "rotate-180" : "",
                      )}
                    />
                  ) : null}
                  {!!item.badge && item.badge > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </Link>
              )}
              {visibleChildren.length > 0 && (
                <div className="mr-4 mt-0.5 space-y-0.5 border-r border-sidebar-border/70 pr-2">
                  {visibleChildren.map((child) => {
                    const childIsActive =
                      pathname === child.to || pathname.startsWith(`${child.to}/`);
                    return (
                      <Link
                        key={`${child.to}-${child.label}`}
                        to={child.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          childIsActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60",
                        )}
                      >
                        <child.icon className="size-3.5 shrink-0" />
                        <span className="flex-1">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
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
              {top ? getRoleLabel(top) : "—"}
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
              {t("common.profile")}
            </Link>
          </Button>
          <Button onClick={handleSignOut} variant="outline" size="sm" className="gap-2">
            <LogOut className="size-4" />
            {t("common.logout")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <RealtimeBridge uid={profile.id} />
      <OnlinePresencePublisher profile={profile} />
      <IdleLogoutGuard userId={profile.id} onIdle={handleSignOut} />
      <BranchModeGuard isPlatformOwner={isPlatformOwner} />
      <div className="flex flex-col min-h-screen bg-background">
        {/* Desktop sidebar (RTL: stick to right) */}
        <aside className="hidden lg:block fixed inset-y-0 start-0 w-64 border-e border-sidebar-border">
          {SidebarContent}
        </aside>

        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-background/95 backdrop-blur px-3 h-14">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("common.menu")}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side={i18n.language === "en" ? "left" : "right"} className="p-0 w-72">
              {SidebarContent}
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {company?.logo_url ? (
              <img
                src={company.logo_url}
                alt={brandName}
                className="size-6 rounded object-contain shrink-0"
              />
            ) : (
              <Store className="size-5 text-primary shrink-0" />
            )}
            <div className="min-w-0 leading-tight">
              <span className="block font-semibold text-sm truncate">{t("common.appName")}</span>
              <BranchSubtitle />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <LanguageSwitcher userId={profile?.id} />
            <NotificationsBell />
          </div>
        </header>

        {/* Floating header — desktop only */}
        <div className="hidden lg:flex fixed top-4 end-4 z-40 items-center gap-2">
          <div className="bg-background/95 backdrop-blur border rounded-full shadow-soft">
            <LanguageSwitcher userId={profile?.id} />
          </div>
          <div className="bg-background/95 backdrop-blur border rounded-full shadow-soft">
            <NotificationsBell />
          </div>
        </div>

        <main className="lg:ms-64 flex-1">
          <PullToRefresh>
            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 lg:py-10">{children}</div>
            <AppFooter />
          </PullToRefresh>
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
// Signs the user out after a fixed window of inactivity (8h, no warning).
// Mounted only once profile exists, so its hook order stays stable.
function IdleLogoutGuard({
  userId,
  onIdle,
}: {
  userId: string;
  onIdle: () => void;
}) {
  useIdleLogout(onIdle, { userId });
  return null;
}

function RealtimeBridge({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();

  useEffect(() => bindPushToneListener(), []);

  useEffect(() => {
    return () => syncBridgeMonitorClose(bridgeMonitorName(uid));
  }, [uid]);

  useEffect(() => {
    const onBridgeActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; count?: number }>).detail;
      if (!detail?.uid || detail.uid !== uid) return;
      notifyBridgeOperationalActivity(uid, detail.count ?? 1);
    };
    window.addEventListener("tc-bridge-activity", onBridgeActivity);
    return () => window.removeEventListener("tc-bridge-activity", onBridgeActivity);
  }, [uid]);

  useEffect(() => {
    let scheduleBumpTimer: ReturnType<typeof setTimeout> | null = null;
    let notifBumpTimer: ReturnType<typeof setTimeout> | null = null;
    const bumpScheduleQueries = () => {
      if (scheduleBumpTimer) clearTimeout(scheduleBumpTimer);
      // Tiny coalesce only — keep edits feeling realtime (was 500ms and felt laggy).
      scheduleBumpTimer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["schedule"] });
        qc.invalidateQueries({ queryKey: ["schedules-pending"] });
        qc.invalidateQueries({ queryKey: ["schedules-approved"] });
        qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
        qc.invalidateQueries({ queryKey: ["dashboard-approved-list"] });
        qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
        qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
        qc.invalidateQueries({ queryKey: ["dashboard-published-periods"] });
        qc.invalidateQueries({ queryKey: ["dashboard-shift-cards"] });
        qc.invalidateQueries({ queryKey: ["branch-period-shifts"] });
        qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
        qc.invalidateQueries({ queryKey: ["schedules-branch-saved"] });
        qc.invalidateQueries({ queryKey: ["week-schedules"] });
        qc.invalidateQueries({ queryKey: ["schedules-week-saved"] });
        qc.invalidateQueries({ queryKey: ["dashboard-dept-states"] });
        qc.invalidateQueries({ queryKey: ["schedule-shifts"] });
      }, 50);
    };

    const monitorName = bridgeMonitorName(uid);
    const supabaseChannelName = bridgeSupabaseChannelName(uid, activeBranchId);
    syncBridgeMonitorOpen({
      monitorName,
      userId: uid,
      branchId: activeBranchId,
      supabaseChannel: supabaseChannelName,
    });
    syncBridgeSupabaseStatus(monitorName, "connecting");
    const { raw: rawBridgeChannel, channel: channelBase } = createBridgeChannel(supabaseChannelName);
    let ch = channelBase;
    const onPg = (
      config: Parameters<typeof bridgePostgresOn>[2],
      handler: (payload: unknown) => void,
    ) => {
      ch = bridgePostgresOn(ch, monitorName, config, handler);
    };

    onPg(
        { event: "*", schema: "public", table: "user_roles" },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["all-roles"] });
          qc.invalidateQueries({ queryKey: ["permissions-list"] });
          const affected = payload?.new?.user_id ?? payload?.old?.user_id;
          if (!affected || affected === uid) {
            qc.invalidateQueries({ queryKey: ["auth", "me"] });
            qc.invalidateQueries({ queryKey: ["task-perm"] });
            qc.invalidateQueries({ queryKey: ["current-user-permissions", uid] });
            qc.invalidateQueries({ queryKey: ["shell-can-manage-breaks"] });
            qc.invalidateQueries({ queryKey: canManageBreaksQueryKey(uid) });
          }
          qc.invalidateQueries({ queryKey: ["user-perms"] });
          qc.invalidateQueries({ queryKey: ["route-guard"] });
        },
      );
    onPg(
        { event: "*", schema: "public", table: "user_task_permissions" },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["permissions-list"] });
          qc.invalidateQueries({ queryKey: ["user-perms"] });
          qc.invalidateQueries({ queryKey: ["task-perm"] });
          const affected = payload?.new?.user_id ?? payload?.old?.user_id;
          if (!affected || affected === uid) {
            qc.invalidateQueries({ queryKey: ["auth", "me"] });
            qc.invalidateQueries({ queryKey: ["current-user-permissions", uid] });
            qc.invalidateQueries({ queryKey: ["shell-can-manage-breaks", uid] });
            qc.invalidateQueries({ queryKey: canManageBreaksQueryKey(uid) });
          }
          qc.invalidateQueries({ queryKey: ["route-guard"] });
        },
      );
    onPg(
        { event: "*", schema: "public", table: "profiles" },
        (payload: any) => {
          const affected = payload?.new?.id ?? payload?.old?.id;
          if (!affected || affected === uid) {
            qc.invalidateQueries({ queryKey: ["auth", "me"] });
            qc.invalidateQueries({ queryKey: ["route-guard", "is-active", uid] });
            invalidateShiftVisibleQueries(qc, uid, activeBranchId);
          }
          qc.invalidateQueries({ queryKey: ["employees"] });
          qc.invalidateQueries({ queryKey: ["departments"] });
          qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
          qc.invalidateQueries({ queryKey: ["dashboard-shift-cards"] });
          qc.invalidateQueries({ queryKey: ["dept-employees"] });
          qc.invalidateQueries({ queryKey: ["dept-employees-for-manager"] });
          qc.invalidateQueries({ queryKey: ["eom", "current"] });
        },
      );
    onPg({ event: "*", schema: "public", table: "departments" }, () => {
        // Do not invalidate auth/me here — that re-spins the whole shell for every dept tweak.
        qc.invalidateQueries({ queryKey: ["departments"] });
        qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
        qc.invalidateQueries({ queryKey: ["dashboard", "department-managers"] });
        qc.invalidateQueries({ queryKey: ["departments-list"] });
        qc.invalidateQueries({ queryKey: ["dept-employees-for-manager"] });
        qc.invalidateQueries({ queryKey: ["other-dept-managers"] });
      });
    onPg({ event: "*", schema: "public", table: "job_titles" }, () => {
        qc.invalidateQueries({ queryKey: ["job-titles"] });
        qc.invalidateQueries({ queryKey: ["employees"] });
        qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
        qc.invalidateQueries({ queryKey: ["can-request-break"] });
      });
    onPg({ event: "*", schema: "public", table: "task_assignees" }, () =>
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      );
    onPg({ event: "*", schema: "public", table: "task_departments" }, () =>
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      );
    onPg({ event: "*", schema: "public", table: "task_comments" }, () => {
        qc.invalidateQueries({ queryKey: ["task-activity"] });
        qc.invalidateQueries({ queryKey: ["task-comments"] });
      });
    onPg({ event: "*", schema: "public", table: "task_activity_log" }, () =>
        qc.invalidateQueries({ queryKey: ["task-activity"] }),
      );
    onPg({ event: "*", schema: "public", table: "tasks" }, () => {
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["dashboard", "tasks-stats"] });
      });
    onPg({ event: "*", schema: "public", table: "task_recurrences" }, () =>
        qc.invalidateQueries({ queryKey: ["recurrences"] }),
      );
    onPg({ event: "*", schema: "public", table: "task_images" }, () =>
        qc.invalidateQueries({ queryKey: ["task-images"] }),
      );
    onPg({ event: "*", schema: "public", table: "schedules" }, () => {
        bumpScheduleQueries();
        invalidateShiftVisibleQueries(qc, uid, activeBranchId);
      });
    onPg({ event: "*", schema: "public", table: "schedule_shifts" }, () => {
        bumpScheduleQueries();
        if (activeBranchId) {
          invalidateShiftVisibleQueries(qc, uid, activeBranchId);
        }
      });
    onPg({ event: "*", schema: "public", table: "shift_definitions" }, () => {
        qc.invalidateQueries({ queryKey: ["shift-definitions"] });
        qc.invalidateQueries({ queryKey: ["shift-definitions-active"] });
      });
    onPg(
        { event: "*", schema: "public", table: "shift_definition_day_hours" },
        () => {
          qc.invalidateQueries({ queryKey: ["shift-definitions"] });
          qc.invalidateQueries({ queryKey: ["shift-definitions-active"] });
        },
      );
    onPg(
        { event: "*", schema: "public", table: "break_requests" },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["breaks"] });
          qc.invalidateQueries({ queryKey: ["breaks-admin"] });
          qc.invalidateQueries({ queryKey: ["all-break-requests"] });
          qc.invalidateQueries({ queryKey: ["dashboard-breaks"] });
          qc.invalidateQueries({ queryKey: ["break-stats"] });
          qc.invalidateQueries({ queryKey: ["employees-page-active-breaks"] });
          // Prefer specific keys — avoid prefix ["dashboard"] which also refetches admin headcount.
          qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
          qc.invalidateQueries({ queryKey: ["my-active-break"] });
          qc.invalidateQueries({ queryKey: ["my-break-shortcut"] });
          qc.invalidateQueries({ queryKey: ["my-breaks-today"] });
          qc.invalidateQueries({ queryKey: ["my-break-requests"] });
          qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
          qc.invalidateQueries({ queryKey: ["dashboard-dept-on-break"] });
          qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
          qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
          qc.invalidateQueries({ queryKey: ["dashboard-dept-daily-breaks"] });
          qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks-count"] });
          const affected = payload?.new?.user_id ?? payload?.old?.user_id;
          if (affected === uid) {
            qc.invalidateQueries({ queryKey: ["my-open-break-nav", uid] });
            if (payload?.eventType === "UPDATE") {
              notifyOwnBreakStatusTransition(payload);
            }
          }
        },
      );
    onPg({ event: "*", schema: "public", table: "break_settings" }, () => {
        qc.invalidateQueries({ queryKey: ["break-settings"] });
        qc.invalidateQueries({ queryKey: ["break-settings-active"] });
      });
    onPg({ event: "*", schema: "public", table: "break_policy" }, () => {
        qc.invalidateQueries({ queryKey: ["break-policy"] });
        qc.invalidateQueries({ queryKey: ["break-policy-effective"] });
        qc.invalidateQueries({ queryKey: ["can-request-break"] });
      });
    onPg({ event: "*", schema: "public", table: "leave_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
        qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
        qc.invalidateQueries({ queryKey: ["leave-admin-on-leave"] });
        qc.invalidateQueries({ queryKey: ["dashboard-my-leave"] });
        qc.invalidateQueries({ queryKey: ["dashboard-leave-queue"] });
        qc.invalidateQueries({ queryKey: ["dashboard-shift-cards"] });
        qc.invalidateQueries({ queryKey: ["my-leave-balances"] });
        qc.invalidateQueries({ queryKey: ["leave-admin-balances"] });
        qc.invalidateQueries({ queryKey: ["auth", "me"] });
      });
    onPg({ event: "*", schema: "public", table: "ops_error_entries" }, () => {
        qc.invalidateQueries({ queryKey: ["ops-error-entries"] });
        qc.invalidateQueries({ queryKey: ["ops-error-caps"] });
      });
    onPg({ event: "*", schema: "public", table: "leave_balances" }, () => {
        qc.invalidateQueries({ queryKey: ["my-leave-balances"] });
        qc.invalidateQueries({ queryKey: ["leave-admin-balances"] });
      });
    onPg(
        { event: "*", schema: "public", table: "leave_employee_accrual_rates" },
        () => {
          qc.invalidateQueries({ queryKey: ["leave-emp-accrual-rates"] });
        },
      );
    onPg({ event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["communications"] });
        qc.invalidateQueries({ queryKey: ["comm"] });
        qc.invalidateQueries({ queryKey: ["shell-comm-unread", uid] });
        qc.invalidateQueries({ queryKey: ["notif", "messages"] });
        qc.invalidateQueries({ queryKey: ["emp-dash-msgs"] });
      });
    onPg({ event: "*", schema: "public", table: "message_recipients" }, () => {
        qc.invalidateQueries({ queryKey: ["communications"] });
        qc.invalidateQueries({ queryKey: ["comm"] });
        qc.invalidateQueries({ queryKey: ["shell-comm-unread", uid] });
        qc.invalidateQueries({ queryKey: ["notif", "messages"] });
        qc.invalidateQueries({ queryKey: ["emp-dash-msgs"] });
      });
    onPg({ event: "*", schema: "public", table: "message_targets" }, () => {
        qc.invalidateQueries({ queryKey: ["communications"] });
        qc.invalidateQueries({ queryKey: ["comm"] });
        qc.invalidateQueries({ queryKey: ["emp-dash-msgs"] });
      });
    onPg(
        {
          event: "*",
          schema: "public",
          table: "schedule_notifications",
          filter: `user_id=eq.${uid}`,
        },
        () => {
          // Debounce — one schedule publish can insert dozens of rows; don't refetch per row.
          if (notifBumpTimer) clearTimeout(notifBumpTimer);
          notifBumpTimer = setTimeout(() => {
            qc.invalidateQueries({ queryKey: ["notif", "schedule"] });
            qc.invalidateQueries({ queryKey: ["emp-dash-notif"] });
          }, 400);
        },
      );
    onPg({ event: "*", schema: "public", table: "company_settings" }, () =>
        qc.invalidateQueries({ queryKey: ["company-settings"] }),
      );
    onPg({ event: "*", schema: "public", table: "employee_of_month" }, () => {
        qc.invalidateQueries({ queryKey: ["employee-of-month"] });
        qc.invalidateQueries({ queryKey: ["eom", "current"] });
      });

    const bumpManagementOnShift = () => {
      if (!activeBranchId) return;
      qc.invalidateQueries({ queryKey: ["management-on-shift", activeBranchId] });
      invalidateShiftVisibleQueries(qc, uid, activeBranchId);
    };
    const bumpCustodyForBranch = () => {
      if (!activeBranchId) return;
      invalidateCustodyQueries(qc, activeBranchId, uid);
    };

    if (activeBranchId) {
      const branchFilter = `branch_id=eq.${activeBranchId}`;
      onPg(
          {
            event: "*",
            schema: "public",
            table: "morning_board_items",
            filter: branchFilter,
          },
          () => {
            qc.invalidateQueries({ queryKey: ["morning-board", activeBranchId] });
          },
      );
      onPg(
          {
            event: "INSERT",
            schema: "public",
            table: "management_on_shift",
            filter: branchFilter,
          },
          bumpManagementOnShift,
      );
      onPg(
          {
            event: "UPDATE",
            schema: "public",
            table: "management_on_shift",
            filter: branchFilter,
          },
          bumpManagementOnShift,
      );
      onPg(
          { event: "DELETE", schema: "public", table: "management_on_shift" },
          bumpManagementOnShift,
      );
      onPg(
          {
            event: "*",
            schema: "public",
            table: "custody_checkouts",
            filter: branchFilter,
          },
          bumpCustodyForBranch,
      );
      onPg(
          {
            event: "*",
            schema: "public",
            table: "custody_item_types",
            filter: branchFilter,
          },
          bumpCustodyForBranch,
      );
      onPg(
          {
            event: "*",
            schema: "public",
            table: "custody_branch_settings",
            filter: branchFilter,
          },
          bumpCustodyForBranch,
      );
      onPg(
          {
            event: "INSERT",
            schema: "public",
            table: "custody_session_archive",
            filter: branchFilter,
          },
          bumpCustodyForBranch,
      );
      onPg(
          {
            event: "*",
            schema: "public",
            table: "branch_banners",
            filter: branchFilter,
          },
          () => {
            qc.invalidateQueries({ queryKey: ["branch-banner", activeBranchId] });
          },
      );
    }

    ch.subscribe((status, err) => {
      const errLabel =
        err == null ? status : `error:${err instanceof Error ? err.message : String(err)}`;
      syncBridgeSupabaseStatus(monitorName, errLabel);
    });
    return () => {
      if (scheduleBumpTimer) clearTimeout(scheduleBumpTimer);
      if (notifBumpTimer) clearTimeout(notifBumpTimer);
      syncBridgeSupabaseStatus(monitorName, "reconnecting");
      void supabase.removeChannel(rawBridgeChannel);
    };
  }, [uid, qc, activeBranchId]);
  return null;
}

// Branch modules (Dashboard, Employees, Departments, Schedule, Tasks,
// Messages, Settings, etc.) require an explicitly-selected active Branch.
// Everything under /platform, /system, /profile and /change-password is
// Platform/neutral territory and stays reachable without one.
const BRANCH_MODE_EXEMPT_PREFIXES = [
  "/platform",
  "/system",
  "/profile",
  "/change-password",
  "/ai-assistant",
];

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
  const { t } = useTranslation();
  const { activeBranchId, isLoading } = useActiveBranch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPlatformOwner || isLoading || activeBranchId) return;
    if (!isBranchModuleRoute(pathname)) return;
    toast.info(t("appShell.selectActiveBranchToEnter"));
    navigate({ to: "/platform", replace: true });
  }, [isPlatformOwner, isLoading, activeBranchId, pathname, navigate, t]);

  return null;
}

// Displays only the Platform hierarchy currently selected in the contexts.
// It intentionally does not read `useActiveBranch`: leaving Platform Branch
// Mode must remove the indicator synchronously with the Platform selection.
function BranchSubtitle() {
  const { t, i18n } = useTranslation();
  const { activeCompany } = useCompanyContext();
  const { activeBranch } = useBranchContext();
  const name = activeBranch?.name?.trim() ?? activeCompany?.name?.trim();
  if (!name) return null;
  const label =
    activeBranch && i18n.language === "he" && name.startsWith("סניף")
      ? name
      : activeBranch
        ? t("appShell.branchPrefix", { name })
        : name;
  return <p className="text-xs text-muted-foreground truncate">{label}</p>;
}
