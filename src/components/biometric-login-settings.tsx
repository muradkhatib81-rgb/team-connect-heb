import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/lib/use-auth";
import { isNativeApp } from "@/lib/native-app";
import {
  disableBiometricLogin,
  enableBiometricLogin,
  getBiometricLoginState,
  isBiometricUserCancel,
} from "@/lib/biometric-login";

export function BiometricLoginSettings() {
  const { t } = useTranslation();
  const { data: me } = useAuth();
  const native = isNativeApp();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [blockedByFaceOnly, setBlockedByFaceOnly] = useState(false);

  const refresh = useCallback(async () => {
    if (!native) {
      setSupported(false);
      setEnabled(false);
      setBlockedByFaceOnly(false);
      setLoading(false);
      return;
    }
    const state = await getBiometricLoginState();
    setSupported(state.supported);
    setEnabled(state.enabled);
    setBlockedByFaceOnly(state.blockedByFaceOnly);
    setLoading(false);
  }, [native]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onEnable = async () => {
    if (!me?.id_number?.trim()) {
      toast.error(t("biometricLogin.missingId"));
      return;
    }
    setBusy(true);
    try {
      await enableBiometricLogin(me.id_number);
      setEnabled(true);
      toast.success(t("biometricLogin.enabled"));
    } catch (err: unknown) {
      if (isBiometricUserCancel(err)) return;
      toast.error((err as Error)?.message ?? t("biometricLogin.enableError"));
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async () => {
    setBusy(true);
    try {
      await disableBiometricLogin();
      setEnabled(false);
      toast.success(t("biometricLogin.disabled"));
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? t("biometricLogin.disableError"));
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

  if (!native) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <Fingerprint className="size-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{t("biometricLogin.title")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("biometricLogin.webUnsupported")}</p>
        </div>
      </Card>
    );
  }

  if (blockedByFaceOnly) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <Fingerprint className="size-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{t("biometricLogin.title")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("biometricLogin.faceIdNotSupported")}</p>
        </div>
      </Card>
    );
  }

  if (!supported) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <Fingerprint className="size-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{t("biometricLogin.title")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("biometricLogin.unsupported")}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Fingerprint className="size-5 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{t("biometricLogin.title")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("biometricLogin.description")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={enabled}
            disabled={busy}
            onCheckedChange={(on) => void (on ? onEnable() : onDisable())}
            aria-label={t("biometricLogin.title")}
          />
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </div>
    </Card>
  );
}
