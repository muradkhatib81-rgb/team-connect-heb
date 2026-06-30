import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pathless layout that gates the entire /system/* subtree to the
 * singleton Main System Administrator (role: system_admin).
 *
 * Runs on every navigation into the subtree (client-side, since the
 * parent _authenticated layout is ssr:false) and queries the database
 * directly — RLS plus the database trigger that enforces the singleton
 * are the real source of truth.
 */
export const Route = createFileRoute("/_authenticated/system")({
  beforeLoad: async ({ context, location }) => {
    const userId = (context as any)?.user?.id;
    if (!userId) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "system_admin")
      .maybeSingle();
    if (error || !data) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: () => <Outlet />,
});
