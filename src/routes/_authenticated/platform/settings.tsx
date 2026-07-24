import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { usePlatformContext } from "@/platform";
import { supabase } from "@/integrations/supabase/client";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp";

export const Route = createFileRoute("/_authenticated/platform/settings")({
  component: PlatformSettingsPage,
});

const SUPPORT_EMAIL_KEY = "supportEmail";
const MAINTENANCE_MODE_KEY = "maintenanceMode";
const WHATSAPP_QUERY_KEY = ["platform-settings-whatsapp"] as const;

function PlatformSettingsPage() {
  const { runtime, platform } = usePlatformContext();
  const qc = useQueryClient();
  const [supportEmail, setSupportEmail] = useState("");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const whatsappQ = useQuery({
    queryKey: WHATSAPP_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("whatsapp_number")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data?.whatsapp_number ?? "";
    },
  });

  useEffect(() => {
    setSupportEmail(runtime.getPlatformSetting<string>(SUPPORT_EMAIL_KEY) ?? "");
    setMaintenanceMode(runtime.getPlatformSetting<boolean>(MAINTENANCE_MODE_KEY) ?? false);
  }, [runtime]);

  useEffect(() => {
    if (whatsappQ.data !== undefined) {
      setWhatsappNumber(whatsappQ.data);
    }
  }, [whatsappQ.data]);

  const environment = runtime.getGlobalConfiguration<string>("environment") ?? "development";

  async function handleSave() {
    const trimmed = whatsappNumber.trim();
    if (trimmed && !normalizeWhatsAppPhone(trimmed)) {
      toast.error("מספר וואטסאפ לא תקין");
      return;
    }
    setSaving(true);
    try {
      runtime.setPlatformSetting(SUPPORT_EMAIL_KEY, supportEmail.trim());
      runtime.setPlatformSetting(MAINTENANCE_MODE_KEY, maintenanceMode);

      const { error } = await supabase
        .from("platform_settings")
        .update({ whatsapp_number: trimmed || null })
        .eq("id", 1);
      if (error) throw error;

      await qc.invalidateQueries({ queryKey: WHATSAPP_QUERY_KEY });
      toast.success("הגדרות הפלטפורמה נשמרו");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שמירת ההגדרות נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Settings className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">הגדרות פלטפורמה</h1>
          <p className="text-sm text-muted-foreground mt-1">
            הגדרות גלובליות בהיקף הפלטפורמה — דרך ה-Configuration Manager הקיים
          </p>
        </div>
      </header>

      <Card className="card-elevated p-5 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">מזהה פלטפורמה</p>
            <p className="text-xs text-muted-foreground font-mono" dir="ltr">
              {platform.id}
            </p>
          </div>
          <Badge variant="outline">{environment}</Badge>
        </div>
      </Card>

      <Card className="card-elevated p-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="platform-support-email">אימייל תמיכה של הפלטפורמה</Label>
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
          <Label htmlFor="platform-whatsapp">מספר וואטסאפ ליצירת קשר (מסך התחברות)</Label>
          <Input
            id="platform-whatsapp"
            type="tel"
            dir="ltr"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            maxLength={20}
            placeholder="0501234567 או 972501234567"
            disabled={whatsappQ.isLoading}
          />
          <p className="text-xs text-muted-foreground">
            יוצג כקישור וואטסאפ בתחתית מסך ההתחברות. השאר ריק כדי להסתיר.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">מצב תחזוקה (Maintenance Mode)</p>
            <p className="text-xs text-muted-foreground">
              דגל גלובלי בלבד — אינו חוסם כניסה בפועל בשלב זה
            </p>
          </div>
          <Switch checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" />}
            שמירת הגדרות
          </Button>
        </div>
      </Card>
    </div>
  );
}
