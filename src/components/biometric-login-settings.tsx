import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/lib/use-auth";
import { isNativeApp } from "@/lib/native-app";
import { isBiometricUserCancel, type BiometricLoginState } from "@/lib/biometric-login";

const emptyState = (): BiometricLoginState => ({
  supported: false,
  enabled: false,
  idNumber: null,
  blockedByFaceOnly: false,
  needsAppUpdate: false,
});

export function BiometricLoginSettings() {
  const { t } = useTranslation();
  const { data: me } = useAuth();
  const native = isNativeApp();

  /** Never block the whole card on a hung native bridge. */
  const [probing, setProbing] = useState(native);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<BiometricLoginState>(emptyState);

  useEffect(() => {
    if (!native) {
      setProbing(false);
      return;
    }
    let cancelled = false;
    const failSafe = window.setTimeout(() => {
      if (!cancelled) {
        setState((s) => ({ ...s, needsAppUpdate: true, supported: false }));
        setProbing(false);
      }
    }, 4_000);

    void (async () => {
      try {
        const { getBiometricLoginState } = await import("@/lib/biometric-login");
        const next = await getBiometricLoginState();
        if (cancelled) return;
        setState(next);
      } catch {
        if (!cancelled) setState({ ...emptyState(), needsAppUpdate: true });
      } finally {
        if (!cancelled) setProbing(false);
        window.clearTimeout(failSafe);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(failSafe);
    };
  }, [native]);

  const onEnable = async () => {
    if (!me?.id_number?.trim()) {
      toast.error(t("biometricLogin.missingId"));
      return;
    }
    setBusy(true);
    try {
      const { enableBiometricLogin } = await import("@/lib/biometric-login");
      await enableBiometricLogin(me.id_number);
      setState((s) => ({ ...s, enabled: true, supported: true, needsAppUpdate: false }));
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
      const { disableBiometricLogin } = await import("@/lib/biometric-login");
      await disableBiometricLogin();
      setState((s) => ({ ...s, enabled: false }));
      toast.success(t("biometricLogin.disabled"));
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? t("biometricLogin.disableError"));
    } finally {
      setBusy(false);
    }
  };

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

  if (probing) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <Fingerprint className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t("biometricLogin.title")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("biometricLogin.description")}</p>
        </div>
        <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0 mt-1" />
      </Card>
    );
  }

  if (state.needsAppUpdate) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <Fingerprint className="size-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{t("biometricLogin.title")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("biometricLogin.needsAppUpdate")}</p>
        </div>
      </Card>
    );
  }

  if (state.blockedByFaceOnly) {
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

  if (!state.supported) {
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
            checked={state.enabled}
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
