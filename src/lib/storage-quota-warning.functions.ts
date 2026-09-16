import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadPlatformFeatureFlagState } from "@/lib/platform-feature-flags.server";
import { canSeeStorageQuotaWarnings } from "@/core/config/platform-feature-flags";

export type StorageQuotaWarning = {
  warning: boolean;
  usedBytes?: number;
  storageQuotaMb?: number;
  percent?: number;
  scopeType?: "company" | "branch";
};

export const getMyStorageQuotaWarning = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StorageQuotaWarning> => {
    const flags = await loadPlatformFeatureFlagState();
    if (!flags["platform.storage_quota_warnings"]) return { warning: false };

    const { supabase, userId } = context as { supabase: any; userId: string };
    const [{ data: roles }, { data: perms }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("user_task_permissions")
        .select("can_manage_company_settings")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const roleList = ((roles ?? []) as { role: string }[]).map((r) => r.role);
    if (
      !canSeeStorageQuotaWarnings({
        enabled: true,
        isBranchManager: roleList.includes("branch_manager"),
        isAssistantManager: roleList.includes("assistant_manager"),
        canManageCompanySettings: perms?.can_manage_company_settings === true,
      })
    ) {
      return { warning: false };
    }

    const { data, error } = await supabase.rpc("get_my_storage_quota_warning");
    if (error) {
      if (/does not exist|function/i.test(error.message)) return { warning: false };
      throw new Error(error.message);
    }
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.warning !== true) return { warning: false };
    return {
      warning: true,
      usedBytes: Number(row.used_bytes ?? 0),
      storageQuotaMb: Number(row.storage_quota_mb ?? 0),
      percent: Number(row.percent ?? 0),
      scopeType: row.scope_type === "branch" ? "branch" : "company",
    };
  });
