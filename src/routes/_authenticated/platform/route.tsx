import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { usePlatformOwnerStatus } from "@/lib/platform-owners.hooks";

/**
 * Platform Management layout gate.
 *
 * Access is derived from the authoritative server-side Platform Owner
 * check (getPlatformOwnerStatus → same source used by
 * assertCallerIsPlatformOwner), not from client-side role labels.
 * Destructive actions are additionally re-checked server-side by
 * assertCallerIsPrimary / assertCallerIsPlatformOwner inside each mutation.
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
  const { data, isLoading } = usePlatformOwnerStatus();

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data.isOwner) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

