import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type RequestScope =
  | "employees"
  | "dept_managers"
  | "employees_dept_managers"
  | "employees_dept_assistant"
  | "all";
type ApproverScope = "branch_manager" | "assistant_manager" | "both" | "permission_based";
type DispatcherScope =
  | "self"
  | "dept_manager"
  | "assistant_manager"
  | "branch_manager"
  | "permission_based";

interface PolicyRow {
  id?: string;
  branch_id?: string | null;
  request_scope: RequestScope;
  requires_approval: boolean;
  approver_scope: ApproverScope;
  dispatcher_scope: DispatcherScope;
}

const DEFAULTS: PolicyRow = {
  request_scope: "employees_dept_assistant",
  requires_approval: true,
  approver_scope: "permission_based",
  dispatcher_scope: "self",
};

const REQUEST_SCOPE_VALUES: RequestScope[] = [
  "employees",
  "dept_managers",
  "employees_dept_managers",
  "employees_dept_assistant",
  "all",
];
const APPROVER_SCOPE_VALUES: ApproverScope[] = [
  "branch_manager",
  "assistant_manager",
  "both",
  "permission_based",
];
const DISPATCHER_SCOPE_VALUES: DispatcherScope[] = [
  "self",
  "dept_manager",
  "assistant_manager",
  "branch_manager",
  "permission_based",
];

export function BreakPolicySettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const isMainAdmin = !!me?.roles.includes("main_admin");

  const requestOpts = useMemo(
    () => REQUEST_SCOPE_VALUES.map((v) => ({ v, l: t(`breakPolicy.requestScope.${v}`) })),
    [t],
  );
  const approverOpts = useMemo(
    () => APPROVER_SCOPE_VALUES.map((v) => ({ v, l: t(`breakPolicy.approverScope.${v}`) })),
    [t],
  );
  const dispatchOpts = useMemo(
    () => DISPATCHER_SCOPE_VALUES.map((v) => ({ v, l: t(`breakPolicy.dispatcherScope.${v}`) })),
    [t],
  );

  const q = useQuery({
    queryKey: ["break-policy"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_policy" as any)
        .select("id, branch_id, request_scope, requires_approval, approver_scope, dispatcher_scope")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as PolicyRow | null) ?? DEFAULTS;
    },
  });

  const [form, setForm] = useState<PolicyRow>(DEFAULTS);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  useEffect(() => {
    const ch = supabase
      .channel("break-policy-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_policy" },
        () => {
          qc.invalidateQueries({ queryKey: ["break-policy"] });
          qc.invalidateQueries({ queryKey: ["break-policy-effective"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const saveMut = useMutation({
    mutationFn: async (v: PolicyRow) => {
      const payload = {
        request_scope: v.request_scope,
        requires_approval: v.requires_approval,
        approver_scope: v.approver_scope,
        dispatcher_scope: v.dispatcher_scope,
        updated_by: me!.id,
      };
      if (v.id) {
        const { error } = await supabase
          .from("break_policy" as any)
          .update(payload)
          .eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("break_policy" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(t("breakPolicy.saved"));
      qc.invalidateQueries({ queryKey: ["break-policy"] });
      qc.invalidateQueries({ queryKey: ["break-policy-effective"] });
      qc.invalidateQueries({ queryKey: ["can-request-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("breakPolicy.saveError")),
  });

  if (!isMainAdmin) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {t("breakPolicy.noPermission")}
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-5">
      <header className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Settings2 className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t("breakPolicy.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("breakPolicy.subtitle")}
          </p>
        </div>
      </header>

      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="space-y-1.5">
            <Label>{t("breakPolicy.whoCanRequest")}</Label>
            <Select
              value={form.request_scope}
              onValueChange={(v) => setForm({ ...form, request_scope: v as RequestScope })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {requestOpts.map((o) => (
                  <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium">{t("breakPolicy.requiresApproval")}</div>
              <div className="text-xs text-muted-foreground">
                {t("breakPolicy.requiresApprovalHint")}
              </div>
            </div>
            <Switch
              checked={form.requires_approval}
              onCheckedChange={(v) => setForm({ ...form, requires_approval: v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("breakPolicy.whoApproves")}</Label>
            <Select
              value={form.approver_scope}
              onValueChange={(v) => setForm({ ...form, approver_scope: v as ApproverScope })}
              disabled={!form.requires_approval}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {approverOpts.map((o) => (
                  <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("breakPolicy.whoCanDispatch")}</Label>
            <Select
              value={form.dispatcher_scope}
              onValueChange={(v) => setForm({ ...form, dispatcher_scope: v as DispatcherScope })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {dispatchOpts.map((o) => (
                  <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end">
            <Button
              className="gap-2"
              onClick={() => saveMut.mutate(form)}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("breakPolicy.save")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
