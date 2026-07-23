import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ActiveBranchProvider } from "@/lib/use-active-branch";
import { canAccessRoute } from "@/lib/route-access";
import {
  fetchRouteGuardPermissions,
  fetchRouteGuardProfileActive,
  fetchRouteGuardRoles,
  routeGuardStaleTime,
} from "@/lib/route-guard-data";
import { BranchProvider, CompanyProvider } from "@/platform";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location, context }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    const userId = data.user.id;
    let roles: Awaited<ReturnType<typeof fetchRouteGuardRoles>>;
    let permissions: Awaited<ReturnType<typeof fetchRouteGuardPermissions>>;
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
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }

    const isActive = await context.queryClient.ensureQueryData({
      queryKey: ["route-guard", "is-active", userId],
      queryFn: () => fetchRouteGuardProfileActive(userId),
      staleTime: routeGuardStaleTime,
    });
    const onInactivePage = location.pathname === "/inactive";
    if (!isActive && !onInactivePage) {
      throw redirect({ to: "/inactive" });
    }
    if (isActive && onInactivePage) {
      throw redirect({ to: "/dashboard" });
    }

    if (
      !canAccessRoute({
        pathname: location.pathname,
        roles,
        permissions,
      })
    ) {
      throw redirect({ to: "/dashboard" });
    }
    return { user: data.user };
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
          <AppShell>
            <Outlet />
          </AppShell>
        </BranchProvider>
      </CompanyProvider>
    </ActiveBranchProvider>
  );
}
