import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fingerprint } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { getAttendanceCapabilities } from "@/lib/attendance.functions";

const DASH_TILE =
  "card-elevated flex h-full min-h-[4.75rem] cursor-pointer p-3 transition-colors border border-sky-300/50 bg-sky-50/50 hover:bg-sky-50";
const DASH_TILE_ICON =
  "flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-200/60 text-sky-900";
const DASH_TILE_TITLE = "text-sm font-semibold leading-tight";
const DASH_TILE_SUB =
  "mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground";

export function AttendanceDashboardCard() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const branchId = activeBranchId ?? profile?.branch_id ?? null;
  const capsFn = useServerFn(getAttendanceCapabilities);

  const capsQ = useQuery({
    queryKey: ["attendance-caps", branchId],
    enabled: !!branchId,
    queryFn: () => capsFn({ data: { branchId: branchId! } }),
    staleTime: 60_000,
  });

  if (!capsQ.data?.show_employee_card && !capsQ.data?.show_manager_card) {
    return null;
  }

  return (
    <Link to="/attendance" className="block">
      <Card className={DASH_TILE}>
        <div className="flex h-full w-full items-center gap-2.5">
          <div className={DASH_TILE_ICON}>
            <Fingerprint className="size-4" />
          </div>
          <div className="min-w-0 flex-1 self-center">
            <h3 className={DASH_TILE_TITLE}>{t("attendance.dashTitle")}</h3>
            <p className={DASH_TILE_SUB}>
              {capsQ.data.show_manager_card
                ? t("attendance.dashHintManager")
                : t("attendance.dashHint")}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
