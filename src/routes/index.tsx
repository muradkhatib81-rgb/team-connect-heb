import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolveLandingPath } from "@/lib/use-auth";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    // Platform Owners must land on the Platform Dashboard, never on a
    // Branch, even when hitting "/" directly in an already-signed-in tab.
    // Anonymous visitors fall through to "/dashboard", which itself
    // redirects to "/auth" via the `_authenticated` layout.
    const target = data.user ? await resolveLandingPath(data.user.id) : "/dashboard";
    throw redirect({ to: target });
  },
});
