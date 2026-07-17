import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ActiveBranchProvider } from "@/lib/use-active-branch";
import { canAccessRoute } from "@/lib/route-access";
import { BranchProvider, CompanyProvider } from "@/platform";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    const [{ data: roleRows, error: rolesError }, { data: permissions, error: permissionsError }] =
      await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", data.user.id),
        supabase
          .from("user_task_permissions")
          .select(
            "can_add_employee, can_edit_employee, can_delete_employee, can_reset_employee_password, can_manage_departments, can_manage_employee_of_month",
          )
          .eq("user_id", data.user.id)
          .maybeSingle(),
      ]);
    if (rolesError || permissionsError) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    if (
      !canAccessRoute({
        pathname: location.pathname,
        roles: (roleRows ?? []).map((row) => row.role),
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
