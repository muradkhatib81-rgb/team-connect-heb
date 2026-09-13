import { createFileRoute, redirect } from "@tanstack/react-router";
import { consumeRestoredAppPath } from "@/lib/last-app-path";
import { waitForClientSession } from "@/lib/session-restore";
import { resolveLandingPath } from "@/lib/use-auth";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window !== "undefined") {
      const restored = consumeRestoredAppPath("/");
      if (restored) throw redirect({ href: restored, replace: true });
    }
    const user = await waitForClientSession();
    // Platform Owners must land on the Platform Dashboard, never on a
    // Branch, even when hitting "/" directly in an already-signed-in tab.
    // Anonymous visitors fall through to "/dashboard", which itself
    // redirects to "/auth" via the `_authenticated` layout.
    const target = user ? await resolveLandingPath(user.id) : "/dashboard";
    throw redirect({ to: target, replace: true });
  },
});
