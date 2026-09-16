import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { MaintenanceScreen } from "@/components/maintenance-screen";
import { ForceUpdateScreen } from "@/components/force-update-screen";
import { ActiveBranchProvider } from "@/lib/use-active-branch";
import { canAccessRoute } from "@/lib/route-access";
import { consumeRestoredAppPath } from "@/lib/last-app-path";
import { PageRemountProvider, RemountingOutlet } from "@/lib/page-remount";
import { hasStoredBrowserAuthToken, waitForClientSession } from "@/lib/session-restore";
import {
  fetchRouteGuardPermissions,
  fetchRouteGuardProfileActive,
  fetchRouteGuardRoles,
  routeGuardStaleTime,
} from "@/lib/route-guard-data";
import { BranchProvider, CompanyProvider } from "@/platform";
import { useAuth } from "@/lib/use-auth";
import { isPlatformOwner } from "@/lib/constants";
import { usePlatformFeatureFlagState } from "@/lib/use-platform-feature-flags";
import { shouldForceClientUpdate } from "@/core/config/platform-feature-flags";
import {
  getRunningClientInfo,
  isClientOlderThanMin,
  type RunningClientInfo,
} from "@/lib/client-version";

export const Route = createFileRoute("/_authenticated")({
  // Client-only: session lives in browser storage. SSR beforeLoad sees no
  // user and used to 302 → /auth → role home, so F5 on /tasks opened dashboard.
  ssr: false,
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  ),
  beforeLoad: async ({ location, context }) => {
    // Client-only (ssr:false). Await storage recovery before any /auth
    // redirect so a web F5 never paints the login card. Native has no
    // stored token (persistSession:false); header refresh never reloads.
    const sessionUser = await waitForClientSession();
    if (!sessionUser && !hasStoredBrowserAuthToken()) {
      throw redirect({ to: "/auth", replace: true });
    }

    const restored = consumeRestoredAppPath(
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}${window.location.hash}`
        : location.pathname,
    );
    if (restored) {
      throw redirect({ href: restored, replace: true });
    }

    const resolvedUser = sessionUser ?? (await waitForClientSession());
    if (!resolvedUser) {
      if (!hasStoredBrowserAuthToken()) {
        throw redirect({ to: "/auth", replace: true });
      }
      // Token still on disk but session not readable yet — skip the rest of
      // the gate rather than painting /auth. SessionRestoreGate covers paint.
      return {};
    }

    // Soft-validate with getUser; if it fails but session exists, keep going
    // with the session user so a transient auth API blip does not log them out.
    let user = resolvedUser;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) user = data.user;
    } catch {
      /* keep sessionUser */
    }

    const userId = user.id;
    let roles: Awaited<ReturnType<typeof fetchRouteGuardRoles>> = [];
    let permissions: Awaited<ReturnType<typeof fetchRouteGuardPermissions>> = null;
    try {
      [roles, permissions] = await Promise.all([
        context.queryClient.ensureQueryData({
          queryKey: ["route-guard", "roles", userId],
          queryFn: () => fetchRouteGuardRoles(userId),
          staleTime: routeGuardStaleTime,
        }),
        context.queryClient.ensureQueryData({
          queryKey: ["route-guard", "permissions", userId],
          queryFn: () => fetchRouteGuardPermissions(userId),
          staleTime: routeGuardStaleTime,
        }),
      ]);
    } catch {
      // Do NOT redirect to /auth — a transient RLS/network error would flash
      // the login page while the session is still valid. Empty guard data
      // falls through to canAccessRoute → /dashboard when needed.
      roles = [];
      permissions = null;
    }

    let isActive = true;
    try {
      isActive = await context.queryClient.ensureQueryData({
        queryKey: ["route-guard", "is-active", userId],
        queryFn: () => fetchRouteGuardProfileActive(userId),
        staleTime: routeGuardStaleTime,
      });
    } catch {
      // Same rule: keep the session; assume active until proven otherwise.
      isActive = true;
    }

    const onInactivePage = location.pathname === "/inactive";
    if (!isActive && !onInactivePage) {
      throw redirect({ to: "/inactive", replace: true });
    }
    if (isActive && onInactivePage) {
      throw redirect({ to: "/dashboard", replace: true });
    }

    if (
      !canAccessRoute({
        pathname: location.pathname,
        roles,
        permissions,
      })
    ) {
      throw redirect({ to: "/dashboard", replace: true });
    }
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onInactivePage = pathname === "/inactive";
  const { data: profile } = useAuth();
  const flags = usePlatformFeatureFlagState();
  const owner = isPlatformOwner(profile?.roles ?? []);
  const [client, setClient] = useState<RunningClientInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getRunningClientInfo().then((info) => {
      if (!cancelled) setClient(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (onInactivePage) {
    return <Outlet />;
  }

  if (profile && !owner && flags.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (profile && !owner && flags.maintenanceMode) {
    return <MaintenanceScreen />;
  }

  if (profile && !owner && flags.forceClientUpdate && !client) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (
    profile &&
    client &&
    shouldForceClientUpdate({
      forceClientUpdate: flags.forceClientUpdate,
      isPlatformOwner: owner,
      currentIsOlderThanMin: isClientOlderThanMin(client.version, flags.minClientVersion),
    })
  ) {
    return <ForceUpdateScreen client={client} minClientVersion={flags.minClientVersion} />;
  }

  // The shell is inside every hierarchy context so its navigation is driven
  // by the same Platform -> Company -> Branch state as the routed content.
  return (
    <ActiveBranchProvider>
      <CompanyProvider>
        <BranchProvider>
          <PageRemountProvider>
            <AppShell>
              <RemountingOutlet />
            </AppShell>
          </PageRemountProvider>
        </BranchProvider>
      </CompanyProvider>
    </ActiveBranchProvider>
  );
}