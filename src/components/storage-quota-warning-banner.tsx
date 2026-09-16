import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/use-auth";
import { isPlatformOwner } from "@/lib/constants";
import { usePlatformFeatureFlagState } from "@/lib/use-platform-feature-flags";
import { canSeeStorageQuotaWarnings } from "@/core/config/platform-feature-flags";
import { getMyStorageQuotaWarning } from "@/lib/storage-quota-warning.functions";
import { formatUsedBytes, mbToGbLabel } from "@/lib/billing-storage";
import { useCurrentPermissions } from "@/lib/use-current-permissions";

export function StorageQuotaWarningBanner() {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const flags = usePlatformFeatureFlagState();
  const permissionsQ = useCurrentPermissions(profile?.id);
  const fn = useServerFn(getMyStorageQuotaWarning);
  const owner = isPlatformOwner(profile?.roles ?? []);
  const roles = profile?.roles ?? [];
  const allowed = canSeeStorageQuotaWarnings({
    enabled: flags.storageQuotaWarnings,
    isBranchManager: roles.includes("branch_manager"),
    isAssistantManager: roles.includes("assistant_manager"),
    canManageCompanySettings: permissionsQ.data?.can_manage_company_settings === true,
  });

  const query = useQuery({
    queryKey: ["storage-quota-warning", profile?.id],
    enabled: !!profile?.id && allowed && !owner,
    queryFn: () => fn(),
    staleTime: 60_000,
  });

  if (!allowed || owner || query.data?.warning !== true) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0">
        {t("storageQuotaWarning.message", {
          used: formatUsedBytes(query.data.usedBytes ?? 0),
          quota: mbToGbLabel(query.data.storageQuotaMb ?? null),
          percent: query.data.percent ?? 80,
        })}
      </p>
    </div>
  );
}
