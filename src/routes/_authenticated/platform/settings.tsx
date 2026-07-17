import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { usePlatformContext } from "@/platform";

export const Route = createFileRoute("/_authenticated/platform/settings")({
  component: PlatformSettingsPage,
});

const SUPPORT_EMAIL_KEY = "supportEmail";
const MAINTENANCE_MODE_KEY = "maintenanceMode";

function PlatformSettingsPage() {
  const { runtime, platform } = usePlatformContext();
  const [supportEmail, setSupportEmail] = useState("");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSupportEmail(runtime.getPlatformSetting<string>(SUPPORT_EMAIL_KEY) ?? "");
    setMaintenanceMode(runtime.getPlatformSetting<boolean>(MAINTENANCE_MODE_KEY) ?? false);
  }, [runtime]);

  const environment = runtime.getGlobalConfiguration<string>("environment") ?? "development";

  function handleSave() {
    setSaving(true);
    try {
      runtime.setPlatformSetting(SUPPORT_EMAIL_KEY, supportEmail.trim());
      runtime.setPlatformSetting(MAINTENANCE_MODE_KEY, maintenanceMode);
      toast.success("הגדרות הפלטפורמה נשמרו");
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
