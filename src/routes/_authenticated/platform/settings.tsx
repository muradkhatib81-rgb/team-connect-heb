import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Settings, Loader2, ImagePlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { usePlatformContext } from "@/platform";
import { supabase } from "@/integrations/supabase/client";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp";
import {
  DEFAULT_PWA_ICON_192,
  PWA_ICON_QUERY_KEY,
  applyPwaBranding,
  fetchPlatformPwaIconUrl,
  uploadPlatformPwaIcon,
} from "@/lib/pwa-branding";

export const Route = createFileRoute("/_authenticated/platform/settings")({
  component: PlatformSettingsPage,
});

const MAINTENANCE_MODE_KEY = "maintenanceMode";
const PLATFORM_SETTINGS_QUERY_KEY = ["platform-settings"] as const;

function PlatformSettingsPage() {
  const { t } = useTranslation();
  const { runtime, platform } = usePlatformContext();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [supportEmail, setSupportEmail] = useState("");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  const settingsQ = useQuery({
    queryKey: PLATFORM_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("whatsapp_number, support_email")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return {
        whatsappNumber: data?.whatsapp_number ?? "",
        supportEmail: data?.support_email ?? "",
      };
    },
  });

  const iconQ = useQuery({
    queryKey: PWA_ICON_QUERY_KEY,
    queryFn: fetchPlatformPwaIconUrl,
  });

  useEffect(() => {
    setMaintenanceMode(runtime.getPlatformSetting<boolean>(MAINTENANCE_MODE_KEY) ?? false);
  }, [runtime]);

  useEffect(() => {
    if (settingsQ.data !== undefined) {
      setWhatsappNumber(settingsQ.data.whatsappNumber);
      setSupportEmail(settingsQ.data.supportEmail);
    }
  }, [settingsQ.data]);

  const environment = runtime.getGlobalConfiguration<string>("environment") ?? "development";
  const previewIcon = iconQ.data || DEFAULT_PWA_ICON_192;

  async function handleSave() {
    const trimmed = whatsappNumber.trim();
    if (trimmed && !normalizeWhatsAppPhone(trimmed)) {
      toast.error(t("platformSettings.invalidWhatsapp"));
      return;
    }
    setSaving(true);
    try {
      runtime.setPlatformSetting(MAINTENANCE_MODE_KEY, maintenanceMode);

      const { error } = await supabase
        .from("platform_settings")
        .update({
          whatsapp_number: trimmed || null,
          support_email: supportEmail.trim() || null,
        })
        .eq("id", 1);
      if (error) throw error;

      await qc.invalidateQueries({ queryKey: PLATFORM_SETTINGS_QUERY_KEY });
      toast.success(t("platformSettings.saveSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("platformSettings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleIconChange(file: File | undefined) {
    if (!file) return;
    setUploadingIcon(true);
    try {
      const url = await uploadPlatformPwaIcon(file);
      await qc.invalidateQueries({ queryKey: PWA_ICON_QUERY_KEY });
      applyPwaBranding(url);
      toast.success(t("platformSettings.iconUpdated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("platformSettings.iconUploadFailed"));
    } finally {
      setUploadingIcon(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Settings className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("platformSettings.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("platformSettings.subtitle")}
          </p>
        </div>
      </header>

      <Card className="card-elevated p-5 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("platformSettings.platformId")}</p>
            <p className="text-xs text-muted-foreground font-mono" dir="ltr">
              {platform.id}
            </p>
          </div>
          <Badge variant="outline">{environment}</Badge>
        </div>
      </Card>

      <Card className="card-elevated p-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="platform-support-email">{t("platformSettings.supportEmail")}</Label>
          <Input
            id="platform-support-email"
            type="email"
            dir="ltr"
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            maxLength={160}
            placeholder="support@platform.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="platform-whatsapp">{t("platformSettings.whatsappNumber")}</Label>
          <Input
            id="platform-whatsapp"
            type="tel"
            dir="ltr"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            maxLength={20}
            placeholder={t("platformSettings.whatsappPlaceholder")}
            disabled={settingsQ.isLoading}
          />
          <p className="text-xs text-muted-foreground">
            {t("platformSettings.whatsappHint")}
          </p>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">{t("platformSettings.maintenanceMode")}</p>
            <p className="text-xs text-muted-foreground">
              {t("platformSettings.maintenanceHint")}
            </p>
          </div>
          <Switch checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("platformSettings.saveSettings")}
          </Button>
        </div>
      </Card>

      <Card className="card-elevated p-6 space-y-4">
        <div>
          <p className="text-sm font-medium">{t("platformSettings.pwaIconTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("platformSettings.pwaIconDesc")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="size-20 rounded-2xl border bg-muted/40 overflow-hidden flex items-center justify-center">
            {iconQ.isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <img src={previewIcon} alt="" className="size-full object-cover" />
            )}
          </div>
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void handleIconChange(e.target.files?.[0])}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={uploadingIcon}
              onClick={() => fileRef.current?.click()}
            >
              {uploadingIcon ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {t("platformSettings.changeIcon")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("platformSettings.pwaIconFormat")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
