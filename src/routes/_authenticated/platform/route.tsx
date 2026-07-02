import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/use-auth";
import { Loader2 } from "lucide-react";

/**
 * Platform Management layout gate.
 *
 * Every child route under /platform/* is visible only to Platform Owners
 * (system_admin OR main_admin). Non-owners are redirected to /dashboard.
 * Destructive actions inside each page are additionally re-checked
 * server-side by assertCallerIsPrimary / assertCallerIsPlatformOwner.
 */
export const Route = createFileRoute("/_authenticated/platform")({
  component: PlatformLayout,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? "שגיאה"}
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">הדף לא נמצא</div>
  ),
});

function PlatformLayout() {
  const { data: profile, isLoading } = useAuth();

  if (isLoading || !profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const isOwner =
    profile.roles.includes("system_admin") || profile.roles.includes("main_admin");

  if (!isOwner) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
