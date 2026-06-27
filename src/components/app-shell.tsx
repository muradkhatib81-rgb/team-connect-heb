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
} from "@/lib/constants";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "@/components/notifications-bell";

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

  const isMainAdminEarly = !!profile?.roles?.includes("main_admin");

  const breakPermQ = useQuery({
    enabled: !!profile?.id && !isMainAdminEarly,
    queryKey: ["shell-can-manage-breaks", profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_breaks")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return !!(data as any)?.can_manage_breaks;
    },
  });

  // Unread communications count (messages + unread announcements)
  const commUnreadQ = useQuery({
    enabled: !!profile?.id,
    queryKey: ["shell-comm-unread", profile?.id],
    refetchInterval: 60_000,
    queryFn: async () => {
      const uid = profile!.id;
      const [{ count: msgCount }, annRes, readsRes] = await Promise.all([
        supabase
          .from("message_recipients")
          .select("message_id", { count: "exact", head: true })
          .eq("user_id", uid)
          .is("read_at", null)
          .is("archived_at", null),
        supabase
          .from("announcements")
          .select("id")
          .is("deleted_at", null)
          .lte("starts_at", new Date().toISOString()),
        supabase.from("announcement_reads").select("announcement_id").eq("user_id", uid),
      ]);
      const annIds = (annRes.data ?? []).map((a: any) => a.id);
      const readIds = new Set((readsRes.data ?? []).map((r: any) => r.announcement_id));
      const annUnread = annIds.filter((id) => !readIds.has(id)).length;
      return (msgCount ?? 0) + annUnread;
    },
  });

  useEffect(() => {
    if (!profile) return;
    if (
      profile.must_change_password &&
      pathname !== "/change-password"
    ) {
      navigate({ to: "/change-password", replace: true });
      return;
    }
    if (pathname === "/dashboard") {
      const admin2 = isAdmin(profile.roles);
      const deptMgr = profile.roles.includes("department_manager");
      if (!admin2 && !deptMgr) {
        navigate({ to: "/profile", replace: true });
      }
    }
  }, [profile?.must_change_password, profile, pathname, navigate]);

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
  const isBranchOrAssistant =
    profile.roles.includes("branch_manager") || profile.roles.includes("assistant_manager");

  // Managers of breaks: main admin, branch/assistant manager, or any user with the explicit perm.
  const isBreaksManager = isMainAdmin || isBranchOrAssistant || !!breakPermQ.data;
  // Only employees and department managers (without manager role / breaks perm) can request a break.
  const canRequestBreak = !isBreaksManager;


  const nav: { to: string; label: string; icon: typeof LayoutDashboard; visible: boolean; badge?: number }[] = [
    { to: "/dashboard", label: "לוח בקרה", icon: LayoutDashboard, visible: !isPlainEmployee },
    { to: "/tasks", label: "משימות", icon: ListTodo, visible: true },
    { to: "/schedules", label: "סידורי עבודה", icon: CalendarDays, visible: true },
    { to: "/communications", label: "מרכז תקשורת", icon: Megaphone, visible: true, badge: commUnreadQ.data ?? 0 },
    { to: "/breaks", label: "הפסקה", icon: Coffee, visible: canRequestBreak },
    { to: "/breaks-admin", label: "ניהול הפסקות", icon: Coffee, visible: isBreaksManager },

    { to: "/employees", label: "ניהול עובדים", icon: Users, visible: admin },
    { to: "/departments", label: "מחלקות", icon: Building2, visible: admin },
    { to: "/permissions", label: "הרשאות", icon: ShieldCheck, visible: canManageUsers(profile.roles) },
    { to: "/company-settings", label: "הגדרות חברה", icon: Building, visible: isMainAdmin },
    { to: "/profile", label: "הפרופיל שלי", icon: UserCircle, visible: isPlainEmployee },
  ].filter((n) => n.visible);


  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("התנתקת מהמערכת");
    navigate({ to: "/auth", replace: true });
  }

  const SidebarContent = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl gradient-brand flex items-center justify-center shadow-soft shrink-0 overflow-hidden">
            {company?.logo_url ? (
              <img src={company.logo_url} alt={company.company_name} className="size-full object-contain bg-white" />
            ) : (
              <Store className="size-5 text-primary-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">{APP_NAME}</p>
            <p className="text-xs text-muted-foreground truncate">{company?.company_name}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
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
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-sm font-semibold shrink-0">
            {profile.full_name?.charAt(0) || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{profile.full_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {top ? ROLE_LABELS[top] : "—"} · {profile.department_name ?? "—"}
            </p>
          </div>
        </div>
        <Button onClick={handleSignOut} variant="outline" size="sm" className="w-full gap-2">
          <LogOut className="size-4" />
          התנתקות
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar (RTL: stick to right) */}
      <aside className="hidden lg:block fixed inset-y-0 right-0 w-64 border-l border-sidebar-border">
        {SidebarContent}
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/95 backdrop-blur px-4 h-14">
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
        <div className="flex items-center gap-2 min-w-0">
          {company?.logo_url ? (
            <img src={company.logo_url} alt={company.company_name} className="size-6 rounded object-contain shrink-0" />
          ) : (
            <Store className="size-5 text-primary shrink-0" />
          )}
          <span className="font-semibold text-sm truncate">{APP_NAME}</span>
        </div>
        <NotificationsBell />
      </header>

      {/* Floating notifications bell — desktop only (mobile uses the one in the header) */}
      <div className="hidden lg:block fixed top-4 left-4 z-40">
        <div className="bg-background/95 backdrop-blur border rounded-full shadow-soft">
          <NotificationsBell />
        </div>
      </div>

      <main className="lg:mr-64">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
