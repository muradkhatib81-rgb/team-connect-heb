import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getActiveBranchScope } from "@/integrations/supabase/branch-scope";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useCompanySettings, type ScheduleType } from "@/lib/use-company-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, Building2, CalendarRange } from "lucide-react";
import { useCurrentPermissions } from "@/lib/use-current-permissions";
import i18n from "@/i18n";

export const Route = createFileRoute("/_authenticated/company-settings")({
  ssr: false,
  head: () => ({ meta: [{ title: i18n.t("companySettingsPage.pageTitle") }] }),
  component: CompanySettingsPage,
});

const MAX_LOGO_BYTES = 500 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function CompanySettingsPage() {
  const { t } = useTranslation();
  const { data: profile, isLoading: profileLoading } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const { data: company, isLoading } = useCompanySettings();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    company_name: "",
    address: "",
    phone: "",
    email: "",
    primary_color: "",
    logo_url: "" as string | null | "",
    schedule_type: "weekly" as ScheduleType,
  });

  const isMainAdmin = !!profile?.roles?.includes("main_admin");
  const permissionsQ = useCurrentPermissions(profile?.id);
  const canManageSettings =
    !!profile &&
    (profile.roles.includes("system_admin") ||
      profile.roles.includes("main_admin") ||
      (profile.roles.includes("assistant_manager") &&
        permissionsQ.data?.can_manage_company_settings === true));

  const manageSchedQ = useQuery({
    enabled: !!profile?.id && !isMainAdmin,
    queryKey: ["perm", "can_manage_schedule", profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_schedule")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return !!(data as any)?.can_manage_schedule;
    },
  });
  const canManageSchedule = isMainAdmin || !!manageSchedQ.data;

  useEffect(() => {
    if (company) {
      setForm({
        company_name: company.company_name ?? "",
        address: company.address ?? "",
        phone: company.phone ?? "",
        email: company.email ?? "",
        primary_color: company.primary_color ?? "",
        logo_url: company.logo_url ?? "",
        schedule_type: company.schedule_type ?? "weekly",
      });
    }
  }, [
    company?.id,
    company?.company_name,
    company?.address,
    company?.phone,
    company?.email,
    company?.primary_color,
    company?.logo_url,
    company?.schedule_type,
  ]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (canManageSettings && !form.company_name.trim()) {
        throw new Error(t("companySettingsPage.errCompanyNameRequired"));
      }
      if (!getActiveBranchScope() && !activeBranchId) {
        throw new Error(t("companySettingsPage.errSelectBranch"));
      }
      const payload: Record<string, unknown> = {};
      if (canManageSettings) {
        Object.assign(payload, {
          company_name: form.company_name.trim(),
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          primary_color: form.primary_color.trim() || null,
          logo_url: form.logo_url || null,
        });
      }
      if (canManageSchedule) {
        payload.schedule_type = form.schedule_type;
      }

      const { data: existing, error: fetchErr } = await supabase
        .from("company_settings" as any)
        .select("id")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (fetchErr) throw fetchErr;

      const existingId = (existing as any)?.id as string | undefined;
      if (existingId) {
        const { error } = await supabase
          .from("company_settings" as any)
          .update(payload)
          .eq("id", existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("company_settings" as any)
          .insert({ ...payload, is_active: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(t("companySettingsPage.saved"));
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("companySettingsPage.saveFailed")),
  });

  async function handleLogoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(t("companySettingsPage.errImageFile"));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t("companySettingsPage.errLogoSize"));
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setForm((f) => ({ ...f, logo_url: dataUrl }));
    } catch {
      toast.error(t("companySettingsPage.errFileLoad"));
    }
  }

  if (isLoading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!canManageSettings && !canManageSchedule) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <div className="size-12 rounded-xl bg-destructive/10 flex items-center justify-center">
          <Building2 className="size-6 text-destructive" />
        </div>
        <h1 className="text-xl font-bold">{t("companySettingsPage.noPermissionTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("companySettingsPage.noPermissionDesc")}
        </p>
      </div>
    );
  }

  const scheduleOptions = [
    { v: "weekly" as const, label: t("companySettingsPage.scheduleWeekly") },
    { v: "monthly" as const, label: t("companySettingsPage.scheduleMonthly") },
    { v: "custom" as const, label: t("companySettingsPage.scheduleCustom") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl gradient-brand flex items-center justify-center">
          <Building2 className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("companySettingsPage.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("companySettingsPage.subtitle")}
          </p>
        </div>
      </div>

      {canManageSchedule && (
        <Card className="card-elevated p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarRange className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">{t("companySettingsPage.scheduleTypeTitle")}</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("companySettingsPage.scheduleTypeHint")}
          </p>
          <RadioGroup
            value={form.schedule_type}
            onValueChange={(v) => setForm((f) => ({ ...f, schedule_type: v as ScheduleType }))}
            className="grid sm:grid-cols-3 gap-2"
          >
            {scheduleOptions.map((opt) => (
              <label
                key={opt.v}
                className="flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer hover:bg-muted/40"
              >
                <RadioGroupItem value={opt.v} id={`st-${opt.v}`} disabled={opt.v === "custom"} />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </RadioGroup>
          <div className="flex justify-end">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="sm">
              {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : t("companySettingsPage.saveScheduleType")}
            </Button>
          </div>
        </Card>
      )}

      {!canManageSettings ? null : (
      <Card className="card-elevated p-6 space-y-5">
        <div className="space-y-2">
          <Label>{t("companySettingsPage.companyLogo")}</Label>
          <div className="flex items-center gap-4">
            <div className="size-20 rounded-xl border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
              {form.logo_url ? (
                <img src={form.logo_url} alt={t("companySettingsPage.logoAlt")} className="size-full object-contain" />
              ) : (
                <Building2 className="size-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoFile(f);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4 ml-1" />
                {t("companySettingsPage.uploadLogo")}
              </Button>
              {form.logo_url ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, logo_url: "" }))}
                >
                  <Trash2 className="size-4 ml-1" />
                  {t("companySettingsPage.removeLogo")}
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("companySettingsPage.logoHint")}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="company_name">{t("companySettingsPage.companyName")}</Label>
          <Input
            id="company_name"
            value={form.company_name}
            onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
            maxLength={120}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">{t("companySettingsPage.companyAddress")}</Label>
          <Textarea
            id="address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            rows={2}
            maxLength={300}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="phone">{t("companySettingsPage.phoneNumber")}</Label>
            <Input
              id="phone"
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              maxLength={30}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("companySettingsPage.companyEmail")}</Label>
            <Input
              id="email"
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              maxLength={120}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="primary_color">{t("companySettingsPage.primaryColor")}</Label>
          <div className="flex items-center gap-3">
            <Input
              id="primary_color"
              type="color"
              value={form.primary_color || "#000000"}
              onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
              className="w-20 h-10 p-1"
            />
            <Input
              dir="ltr"
              value={form.primary_color}
              placeholder="#3B82F6"
              onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
              maxLength={20}
              className="flex-1"
            />
            {form.primary_color ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, primary_color: "" }))}
              >
                {t("companySettingsPage.clear")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="lg">
            {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : t("companySettingsPage.saveChanges")}
          </Button>
        </div>
      </Card>
      )}
    </div>
  );
}
