import { createFileRoute, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/constants";
import { bootstrapPlatformOwner } from "@/lib/auth-bootstrap.functions";
import { resolveLandingPath } from "@/lib/use-auth";
import { seedIdleSessionOnLogin } from "@/lib/use-idle-logout";
import { useCompanySettings } from "@/lib/use-company-settings";
import { toWhatsAppUrl } from "@/lib/whatsapp";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { Store, Loader2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PasswordInput, PasswordVisibilityToggle } from "@/components/ui/password-input";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { toWesternDigits } from "@/lib/app-locale";

const searchSchema = z.object({ redirect: z.string().optional() });

/** Same-origin path only — blocks //evil, /\evil, and protocol URLs. */
function safeInternalRedirectPath(raw: string | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  const path = raw.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (path.includes("://") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) return fallback;
  return path;
}

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: `${i18n.t("auth.loginPageTitle")} | ${APP_NAME}` }] }),
  component: AuthPage,
});

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;
const ID_REGEX = /^\d{5,15}$/;

function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/auth" });
  const { data: company } = useCompanySettings({ allowUnscoped: true });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const whatsappQ = useQuery({
    queryKey: ["platform-settings-whatsapp-public"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("whatsapp_number")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data?.whatsapp_number ?? null;
    },
    staleTime: 60_000,
  });
  const whatsappUrl = toWhatsAppUrl(whatsappQ.data);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          setHasUsers(true);
          setChecking(false);
          const explicit = search.redirect as string | undefined;
          try {
            const target = safeInternalRedirectPath(
              explicit || (await resolveLandingPath(data.session.user.id)),
            );
            if (!cancelled) router.history.replace(target);
          } catch {
            /* show login form if landing resolve fails */
          }
          return;
        }
        const { data: hasAdmin, error: rpcErr } = await (supabase as any).rpc("has_main_admin");
        if (cancelled) return;
        if (rpcErr) {
          setHasUsers(true);
        } else {
          setHasUsers(!!hasAdmin);
        }
      } catch {
        if (!cancelled) setHasUsers(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, search.redirect, router]);

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const idNumber = toWesternDigits(String(form.get("id_number") || "")).trim();
    const password = String(form.get("password") || "");
    if (!idNumber || !password) {
      toast.error(t("auth.fillIdAndPassword"));
      return;
    }
    if (!ID_REGEX.test(idNumber)) {
      toast.error(t("auth.invalidId"));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: idEmail(idNumber),
      password,
    });
    if (error) {
      setLoading(false);
      toast.error(
        error.message === "Invalid login credentials"
          ? t("auth.wrongCredentials")
          : error.message,
      );
      return;
    }
    toast.success(t("auth.loginSuccess"));
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) seedIdleSessionOnLogin(userData.user.id);
    setLoading(false);
    const explicit = search.redirect as string | undefined;
    const target = safeInternalRedirectPath(
      explicit || (userData.user ? await resolveLandingPath(userData.user.id) : "/dashboard"),
    );
    router.history.replace(target);
  }

  async function handleBootstrap(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const firstName = String(form.get("first_name") || "").trim();
    const lastName = String(form.get("last_name") || "").trim();
    const idNumber = toWesternDigits(String(form.get("id_number") || "")).trim();
    const password = String(form.get("password") || "");
    if (!firstName || !lastName || !idNumber || !password) {
      toast.error(t("auth.fillAll"));
      return;
    }
    if (!ID_REGEX.test(idNumber)) {
      toast.error(t("auth.idMustBeDigits"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("auth.passwordMinLength"));
      return;
    }
    setLoading(true);
    try {
      // Admin createUser (server) — no confirmation email / mailer rate limits.
      // Synthetic local email is only Supabase Auth's identifier; UI is ID+password.
      await bootstrapPlatformOwner({
        data: { first_name: firstName, last_name: lastName, id_number: idNumber, password },
      });
    } catch (err) {
      setLoading(false);
      toast.error(err instanceof Error ? err.message : t("auth.bootstrapTitle"));
      return;
    }
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: idEmail(idNumber),
      password,
    });
    setLoading(false);
    if (signInErr) {
      toast.error(signInErr.message);
      return;
    }
    const { data: bootUserData } = await supabase.auth.getUser();
    if (bootUserData.user) seedIdleSessionOnLogin(bootUserData.user.id);
    toast.success(t("auth.welcomeOwner"));
    // The bootstrap flow always creates the first main_admin — always a
    // Platform Owner — so it always lands on the Platform Dashboard.
    navigate({ to: "/platform", replace: true });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const showBootstrap = hasUsers === false;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex justify-end p-3">
        <LanguageSwitcher />
      </div>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="size-16 rounded-2xl gradient-brand flex items-center justify-center shadow-card overflow-hidden">
              {company?.logo_url ? (
                <img src={company.logo_url} alt={company.company_name} className="size-full object-contain bg-white" />
              ) : (
                <Store className="size-7 text-primary-foreground" />
              )}
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground">{t("auth.appName")}</h1>
              <p className="text-sm text-muted-foreground mt-1">{company?.company_name}</p>
            </div>
          </div>

          <Card className="card-elevated p-6">
            {showBootstrap ? (
              <>
                <div className="mb-5 text-center">
                  <h2 className="text-lg font-semibold">{t("auth.bootstrapTitle")}</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("auth.bootstrapDesc")}
                  </p>
                </div>
                <form onSubmit={handleBootstrap} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="first-name-up">{t("auth.firstName")}</Label>
                      <Input id="first-name-up" name="first_name" required maxLength={50} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last-name-up">{t("auth.lastName")}</Label>
                      <Input id="last-name-up" name="last_name" required maxLength={50} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="id-up">{t("auth.idNumber")}</Label>
                    <Input
                      id="id-up"
                      name="id_number"
                      type="text"
                      inputMode="numeric"
                      pattern="\d*"
                      maxLength={15}
                      required
                      dir="ltr"
                      lang="en"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="pw-up">{t("auth.password")}</Label>
                      <PasswordVisibilityToggle
                        visible={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                      />
                    </div>
                    <PasswordInput
                      id="pw-up"
                      name="password"
                      visible={showPassword}
                      autoComplete="new-password"
                      minLength={6}
                      required
                      dir="ltr"
                      lang="en"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading} size="lg">
                    {loading ? <Loader2 className="size-4 animate-spin" /> : t("auth.createOwner")}
                  </Button>
                </form>
              </>
            ) : (
              <>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="id-in">{t("auth.idNumber")}</Label>
                  <Input
                    id="id-in"
                    name="id_number"
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    autoComplete="username"
                    maxLength={15}
                    required
                    dir="ltr"
                    lang="en"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="pw-in">{t("auth.password")}</Label>
                    <PasswordVisibilityToggle
                      visible={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                    />
                  </div>
                  <PasswordInput
                    id="pw-in"
                    name="password"
                    visible={showPassword}
                    autoComplete="current-password"
                    required
                    dir="ltr"
                    lang="en"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading} size="lg">
                  {loading ? <Loader2 className="size-4 animate-spin" /> : t("auth.signIn")}
                </Button>
                <div className="pt-2 space-y-2">
                  <p className="text-xs text-muted-foreground text-center">
                    {t("auth.noAccount")}
                  </p>
                  {whatsappUrl && (
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white">
                        <WhatsAppIcon className="size-3.5" />
                      </span>
                      <span>{t("auth.contactSupport")}</span>
                    </a>
                  )}
                </div>
              </form>
              </>
            )}
          </Card>

          <p className="text-xs text-muted-foreground text-center mt-6">
            {t("auth.internalSystem")}
          </p>
        </div>
      </div>
    </div>
  );
}
