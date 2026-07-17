import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ActiveBranchProvider } from "@/lib/use-active-branch";

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
  // Wraps AppShell (not just its children) so the shell itself — sidebar
  // navigation included — can read Branch Mode via useActiveBranch() to
  // decide whether branch modules should even be listed. See AppShell.
  return (
    <ActiveBranchProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </ActiveBranchProvider>
  );
}
