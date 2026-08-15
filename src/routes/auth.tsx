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
import { useCompanySettings } from "@/lib/use-company-settings";
import { toWhatsAppUrl } from "@/lib/whatsapp";
import { Store, Loader2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useTranslation } from "react-i18next";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: `התחברות | ${APP_NAME}` }] }),
  component: AuthPage,
});

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;
const ID_REGEX = /^\d{5,15}$/;

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.75.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/auth" });
  const { data: company } = useCompanySettings({ allowUnscoped: true });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);

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
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        const explicit = search.redirect as string | undefined;
        const target = explicit || (await resolveLandingPath(data.session.user.id));
        router.history.replace(target.startsWith("/") ? target : "/dashboard");
        return;
      }
      // Check if a main admin already exists — if so, only show login.
      const { data: hasAdmin, error: rpcErr } = await (supabase as any).rpc("has_main_admin");
      if (cancelled) return;
      if (rpcErr) {
        // Fail safe: assume admin exists so we don't allow accidental bootstrap.
        setHasUsers(true);
      } else {
        setHasUsers(!!hasAdmin);
      }
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, search.redirect]);

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const idNumber = String(form.get("id_number") || "").trim();
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
    setLoading(false);
    const explicit = search.redirect as string | undefined;
    const target =
      explicit || (userData.user ? await resolveLandingPath(userData.user.id) : "/dashboard");
    router.history.replace(target.startsWith("/") ? target : "/dashboard");
  }

  async function handleBootstrap(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const firstName = String(form.get("first_name") || "").trim();
    const lastName = String(form.get("last_name") || "").trim();
    const idNumber = String(form.get("id_number") || "").trim();
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
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pw-up">{t("auth.password")}</Label>
                    <Input
                      id="pw-up"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={6}
                      required
                      dir="ltr"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading} size="lg">
                    {loading ? <Loader2 className="size-4 animate-spin" /> : t("auth.createOwner")}
                  </Button>
                </form>
              </>
            ) : (
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
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw-in">{t("auth.password")}</Label>
                  <Input
                    id="pw-in"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    dir="ltr"
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
