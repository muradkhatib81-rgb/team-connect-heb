import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/use-auth";
import { usePlatformContext } from "@/platform";
import type { UUID } from "@/core";

export const Route = createFileRoute("/_authenticated/platform/notifications")({
  component: PlatformNotificationsPage,
});

function PlatformNotificationsPage() {
  const { runtime } = usePlatformContext();
  const { data: profile } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error("אין משתמש מחובר");
      await runtime.sendPlatformNotification(title.trim(), body.trim(), profile.id as UUID);
    },
    onSuccess: () => {
      toast.success("ההתראה נשלחה (Notification Manager)");
      setTitle("");
      setBody("");
    },
    onError: (error: Error) => toast.error(error.message ?? "השליחה נכשלה"),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Bell className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">התראות פלטפורמה</h1>
          <p className="text-sm text-muted-foreground mt-1">
            שכבת ה-Notification Manager הקיימת. ללא ספק התראות חיצוני (Push/Email/SMS) מחובר בשלב זה
            — שליחה כאן מוכיחה שהמנהל פעיל, בלי לזייף היסטוריה.
          </p>
        </div>
      </header>

      <Card className="card-elevated p-6 space-y-4 max-w-lg">
        <div className="space-y-2">
          <Label htmlFor="notif-title">כותרת</Label>
          <Input
            id="notif-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="כותרת ההתראה"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notif-body">תוכן</Label>
          <Input
            id="notif-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={300}
            placeholder="תוכן ההתראה"
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => sendMut.mutate()}
            disabled={sendMut.isPending || !title.trim() || !body.trim()}
            size="sm"
            className="gap-2"
          >
            <Send className="size-4" />
            שליחת התראת בדיקה
          </Button>
        </div>
      </Card>
    </div>
  );
}
