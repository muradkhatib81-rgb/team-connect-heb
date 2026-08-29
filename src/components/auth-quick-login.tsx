/**
 * Optional fingerprint quick-login on the auth screen.
 * Isolated so /auth itself never loads Capacitor biometric plugins at startup.
 */
import { useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/native-app";

type Props = {
  disabled?: boolean;
  onSuccess: (userId: string) => void | Promise<void>;
};

export function AuthQuickLogin({ disabled, onSuccess }: Props) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [idNumber, setIdNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { peekQuickLoginHint } = await import("@/lib/biometric-login");
        const hint = await peekQuickLoginHint();
        if (cancelled) return;
        setReady(hint.ready);
        setIdNumber(hint.idNumber);
      } catch {
        /* password login remains available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;

  async function onQuickLogin() {
    setBusy(true);
    try {
      const { biometricQuickLogin } = await import("@/lib/biometric-login");
      const result = await biometricQuickLogin();
      if (!result.ok) {
        if (result.reason === "cancelled") return;
        if (result.reason === "expired") toast.error(t("biometricLogin.sessionExpired"));
        else toast.error(t("biometricLogin.loginFailed"));
        setReady(false);
        setIdNumber(null);
        return;
      }
      toast.success(t("auth.loginSuccess"));
      await onSuccess(result.userId);
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? t("biometricLogin.loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 mb-6">
      <Button
        type="button"
        variant="default"
        className="w-full gap-2"
        size="lg"
        disabled={busy || disabled}
        onClick={() => void onQuickLogin()}
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Fingerprint className="size-5" />}
        {t("auth.quickLogin")}
      </Button>
      {idNumber && (
        <p className="text-xs text-center text-muted-foreground">
          {t("auth.quickLoginAs", { id: idNumber })}
        </p>
      )}
      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">{t("auth.orUseIdPassword")}</span>
        </div>
      </div>
    </div>
  );
}
