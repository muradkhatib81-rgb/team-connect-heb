import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { ClipboardList, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useQuery } from "@tanstack/react-query";
import { fetchCustodyUserCaps } from "@/lib/custody-workflow";
import { supportContactInstruction } from "@/lib/constants";
import { CustodyLogPanel } from "@/components/custody-log-panel";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/custody-log")({
  component: CustodyLogPage,
});

function CustodyLogPage() {
  const { t } = useTranslation();
  const { data: me } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const branchId = activeBranchId ?? me?.branch_id ?? null;

  const capsQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["custody-caps", me?.id],
    queryFn: () => fetchCustodyUserCaps(me!.id),
  });

  if (!me) return null;

  if (!branchId) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">{t("custody.noBranchTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-2">{t("custody.selectBranchHint")}</p>
      </Card>
    );
  }

  if (capsQ.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!capsQ.data?.canAccessCustodyLog) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">{t("custody.noPermissionTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t("custody.permissionRequired", {
            contact: supportContactInstruction(me.roles),
          })}
        </p>
      </Card>
    );
  }

  const dateLocale =
    i18n.language === "ar" ? "ar-IL" : i18n.language === "en" ? "en-IL" : "he-IL";
  const todayLabel = new Intl.DateTimeFormat(dateLocale, {
    timeZone: "Asia/Jerusalem",
    dateStyle: "full",
    numberingSystem: "latn",
    calendar: "gregory",
  }).format(new Date());

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-teal-500/10 text-teal-600 flex items-center justify-center">
          <ClipboardList className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("custody.logTitle")}</h1>
          <p className="text-sm text-muted-foreground">{todayLabel}</p>
        </div>
      </header>

      <Card className="card-elevated p-4 sm:p-6">
        <CustodyLogPanel branchId={branchId} />
      </Card>
    </div>
  );
}
