import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { changeOwnPassword } from "@/lib/employees.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/use-auth";
import i18n from "@/i18n";
import { clearBiometricLogin } from "@/lib/biometric-login";

export const Route = createFileRoute("/_authenticated/change-password")({
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const changeFn = useServerFn(changeOwnPassword);
  const [loading, setLoading] = useState(false);
  const required = me?.must_change_password ?? false;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const pw = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (pw.length < 6) {
      toast.error(i18n.t("changePassword.tooShort"));
      return;
    }
    if (pw !== confirm) {
      toast.error(i18n.t("changePassword.mismatch"));
      return;
    }
    setLoading(true);
    try {
      await changeFn({ data: { password: pw } });
      await clearBiometricLogin();
      toast.success(i18n.t("changePassword.success"));
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? i18n.t("changePassword.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <Card className="card-elevated p-6">
        <div className="flex flex-col items-center text-center gap-2 mb-6">
          <div className="size-12 rounded-2xl gradient-brand flex items-center justify-center">
            <KeyRound className="size-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">{i18n.t("changePassword.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {required
              ? i18n.t("changePassword.firstLogin")
              : i18n.t("changePassword.anytime")}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw">{i18n.t("changePassword.newPassword")}</Label>
            <Input id="pw" name="password" type="password" minLength={6} required dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">{i18n.t("changePassword.confirmPassword")}</Label>
            <Input id="confirm" name="confirm" type="password" minLength={6} required dir="ltr" />
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : i18n.t("changePassword.save")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
