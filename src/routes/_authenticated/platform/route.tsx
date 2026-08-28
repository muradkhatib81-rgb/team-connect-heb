import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/use-auth";
import { isPlatformOwner } from "@/lib/constants";

/**
 * Platform Management layout gate.
 *
 * Access is derived from the same client-side role model used by every
 * other admin gate in this app (profile.roles, via useAuth — see
 * src/lib/constants.ts#isPlatformOwner), not from the separate
 * Supabase-backed Platform Owner server check. That dedicated check
 * (getPlatformOwnerStatus / assertCallerIsPlatformOwner) is unchanged and
 * still the source of truth for the actual Platform Owner management
 * mutations (create/suspend/delete/transfer), which re-verify server-side
 * regardless of this client gate.
 */
export const Route = createFileRoute("/_authenticated/platform")({
  component: PlatformLayout,
  errorComponent: PlatformRouteError,
  notFoundComponent: PlatformRouteNotFound,
});

function PlatformRouteError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? t("common.error")}
    </div>
  );
}

function PlatformRouteNotFound() {
  const { t } = useTranslation();
  return <div className="p-6 text-sm text-muted-foreground">{t("platformHub.pageNotFound")}</div>;
}

function PlatformLayout() {
  const { data: profile, isLoading } = useAuth();

  if (isLoading || !profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isPlatformOwner(profile.roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
