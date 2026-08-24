import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useAuth } from "@/lib/use-auth";
import { getOpsErrorCapabilities } from "@/lib/ops-errors.functions";

const DASH_TILE =
  "card-elevated flex h-full min-h-[4.75rem] p-3 transition-colors cursor-pointer hover:bg-accent/30";

/** Interactive dashboard card for the operational errors feature. */
export function OpsErrorsDashboardCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const branchId = activeBranchId ?? profile?.branch_id ?? null;
  const capsFn = useServerFn(getOpsErrorCapabilities);

  const capsQ = useQuery({
    queryKey: ["ops-error-caps", branchId],
    enabled: !!branchId,
    staleTime: 30_000,
    queryFn: () => capsFn({ data: { branchId: branchId! } }),
  });

  const caps = capsQ.data;
  if (!caps?.show_card) return null;

  const tab = caps.can_log ? "create" : "log";
  const count = caps.month_count;

  return (
    <button
      type="button"
      className="w-full text-start"
      onClick={() => navigate({ to: "/control-log", search: { tab } })}
    >
      <Card className={DASH_TILE}>
        <div className="flex h-full w-full items-center gap-2.5">
          <div className="min-w-0 flex-1 self-center text-right">
            <p className="line-clamp-2 text-sm font-semibold leading-tight">
              {t("opsErrors.dashTitle")}
            </p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums leading-none">{count}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("opsErrors.dashHint")}</p>
          </div>
          <div className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600">
            <AlertTriangle className="size-4" />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground shadow">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </div>
        </div>
      </Card>
    </button>
  );
}
