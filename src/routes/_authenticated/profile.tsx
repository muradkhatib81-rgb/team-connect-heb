import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, User, Umbrella } from "lucide-react";
import { ROLE_LABELS, isPlatformOwner, supportContactInstruction } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plane } from "lucide-react";
import {
  formatLeaveDateRange,
  isEmployeeCurrentlyOnLeave,
} from "@/lib/employee-leave";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { resolveLeaveAccess } from "@/lib/leave-permissions";
import { PushNotificationsSettings } from "@/components/push-notifications-settings";


export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { t } = useTranslation();
  const { data: me, isLoading } = useAuth();
  const showLeaveBalances = me
    ? resolveLeaveAccess(me.roles ?? [], null).showRequestCard
    : false;

  const balancesQ = useQuery({
    enabled: !!me?.id && showLeaveBalances,
    queryKey: ["my-leave-balances", me?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_balances")
        .select("manual_balance, accrued_days, used_days, reserved_days, leave_types(name, code)")
        .eq("user_id", me!.id);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        name: row.leave_types?.name ?? row.leave_types?.code ?? i18n.t("leaves.defaultLeaveName"),
        available:
          (row.manual_balance ?? 0) +
          (row.accrued_days ?? 0) -
          (row.used_days ?? 0) -
          (row.reserved_days ?? 0),
      }));
    },
    staleTime: 60_000,
  });

  if (isLoading || !me) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const roleLabel = me.roles?.[0] ? ROLE_LABELS[me.roles[0]] : "—";
  const onLeaveNow = isEmployeeCurrentlyOnLeave(me);
  const leaveRange = formatLeaveDateRange(me.leave_start_date, me.leave_end_date);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <User className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("profile.subtitle")}</p>
        </div>
      </div>

      {onLeaveNow && (
        <Alert className="border-amber-200 bg-amber-50/80">
          <Plane className="size-4 text-amber-700" />
          <AlertDescription className="text-amber-900">
            <span className="font-semibold">{t("profile.onLeaveNow")}</span>
            {leaveRange ? ` (${leaveRange})` : null}
            {" "}{t("profile.forMoreDetails")} {supportContactInstruction(me.roles)}.
          </AlertDescription>
        </Alert>
      )}

      <Card className="p-6 space-y-4">
        <Row label={t("profile.firstName")} value={me.first_name || "—"} />
        <Row label={t("profile.lastName")} value={me.last_name || "—"} />
        <Row label={t("profile.idNumber")} value={me.id_number ?? "—"} />
        <Row label={t("profile.phone")} value={me.phone ?? "—"} />
        {!isPlatformOwner(me.roles) && <Row label={t("profile.department")} value={me.department_name ?? "—"} />}
        <Row label={t("profile.role")} value={roleLabel} />
        <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
          <span className="text-sm text-muted-foreground">{t("profile.status")}</span>
          <span className="text-sm font-medium flex items-center gap-2">
            {onLeaveNow ? (
              <>
                {t("profile.onLeave")}
                <Badge variant="secondary" className="rounded-full text-xs">🏖️</Badge>
              </>
            ) : me.is_active ? (
              t("profile.active")
            ) : (
              t("profile.inactive")
            )}
          </span>
        </div>
        {leaveRange && (
          <Row label={t("profile.leaveDates")} value={leaveRange} />
        )}
      </Card>

      <Card className="p-6 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{t("profile.passwordTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("profile.passwordDesc")}</p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/change-password">
            <KeyRound className="size-4" />
            {t("profile.changePassword")}
          </Link>
        </Button>
      </Card>

      <PushNotificationsSettings />

      {showLeaveBalances && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Umbrella className="size-4 text-primary" />
            <h2 className="font-semibold text-base">{t("profile.leaveBalances")}</h2>
          </div>
          {balancesQ.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : !balancesQ.data?.length ? (
            <p className="text-sm text-muted-foreground text-center py-2">{t("profile.noBalances")}</p>
          ) : (
            balancesQ.data.map((b) => (
              <div
                key={b.name}
                className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
              >
                <span className="text-sm text-muted-foreground">{b.name}</span>
                <span className="text-sm font-semibold tabular-nums">
                  {b.available % 1 === 0
                    ? b.available.toFixed(0)
                    : b.available.toFixed(1)}{" "}
                  {t("profile.days")}
                </span>
              </div>
            ))
          )}
        </Card>
      )}

    </div>
  );
}


function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
