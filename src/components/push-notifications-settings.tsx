import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { savePushSubscription, removePushSubscription } from "@/lib/push.functions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) return null;
    const json = (await res.json()) as { publicKey?: string };
    return json.publicKey?.trim() || null;
  } catch {
    return null;
  }
}

export function PushNotificationsSettings() {
  const { t } = useTranslation();
  const saveSubFn = useServerFn(savePushSubscription);
  const removeSubFn = useServerFn(removePushSubscription);

  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  const refreshState = useCallback(async () => {
    if (typeof window === "undefined") return;
    const ok = "Notification" in window && "serviceWorker" in navigator;
    setSupported(ok);
    if (!ok) {
      setLoading(false);
      return;
    }
    setPermission(Notification.permission);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEnabled(!!sub && Notification.permission === "granted");
    } catch {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const enablePush = async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast.error(t("push.denied"));
        return;
      }

      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) {
        toast.error(t("push.notConfigured"));
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error(t("push.subscribeError"));
      }

      await saveSubFn({
        data: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          userAgent: navigator.userAgent.slice(0, 500),
        },
      });

      setEnabled(true);
      toast.success(t("push.enabled"));
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? t("push.subscribeError"));
    } finally {
      setBusy(false);
    }
  };

  const disablePush = async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        try {
          await removeSubFn({ data: { endpoint } });
        } catch {
          /* non-fatal */
        }
      }
      setEnabled(false);
      toast.success(t("push.disabled"));
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? t("push.unsubscribeError"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </Card>
    );
  }

  if (!supported) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <BellOff className="size-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{t("push.title")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("push.unsupported")}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 flex items-center justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <Bell className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{t("push.title")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("push.description")}</p>
          {permission === "denied" && (
            <p className="text-sm text-destructive mt-2">{t("push.deniedHint")}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {permission === "denied" ? (
          <Button variant="outline" size="sm" disabled>
            {t("push.blocked")}
          </Button>
        ) : (
          <>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(on) => (on ? void enablePush() : void disablePush())}
              aria-label={t("push.title")}
            />
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </>
        )}
      </div>
    </Card>
  );
}
