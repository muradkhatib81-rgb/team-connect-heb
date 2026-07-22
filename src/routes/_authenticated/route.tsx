import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ActiveBranchProvider } from "@/lib/use-active-branch";
import { canAccessRoute } from "@/lib/route-access";
import {
  fetchRouteGuardPermissions,
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
