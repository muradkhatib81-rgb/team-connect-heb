import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ActiveBranchProvider } from "@/lib/use-active-branch";
import { canAccessRoute } from "@/lib/route-access";
import { consumeRestoredAppPath } from "@/lib/last-app-path";
import { PageRemountBoundary, PageRemountProvider } from "@/lib/page-remount";
import {
  fetchRouteGuardPermissions,
  fetchRouteGuardProfileActive,
  fetchRouteGuardRoles,
  routeGuardStaleTime,
} from "@/lib/route-guard-data";
import { BranchProvider, CompanyProvider } from "@/platform";

export const Route = createFileRoute("/_authenticated")({
  // Client-only: session lives in browser storage. SSR beforeLoad sees no
  // user and used to 302 → /auth → role home, so F5 on /tasks opened dashboard.
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    // Prefer local session first so a refresh does not flash /auth while
    // getUser() (network) is still restoring. Only bounce when there is
    // truly no session in storage.
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user ?? null;
    if (!sessionUser) {
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

    // Soft-validate with getUser; if it fails but session exists, keep going
    // with the session user so a transient auth API blip does not log them out.
    let user = sessionUser;
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

  if (onInactivePage) {
    return <Outlet />;
  }

  // The shell is inside every hierarchy context so its navigation is driven
  // by the same Platform -> Company -> Branch state as the routed content.
  return (
    <ActiveBranchProvider>
      <CompanyProvider>
        <BranchProvider>
          <PageRemountProvider>
            <AppShell>
              <PageRemountBoundary>
                <Outlet />
              </PageRemountBoundary>
            </AppShell>
          </PageRemountProvider>
        </BranchProvider>
      </CompanyProvider>
    </ActiveBranchProvider>
  );
}