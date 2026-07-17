import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ActiveBranchProvider } from "@/lib/use-active-branch";
import { BranchProvider, CompanyProvider } from "@/platform";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
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
