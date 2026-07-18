import { createFileRoute, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Store, Loader2 } from "lucide-react";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: `התחברות | ${APP_NAME}` }] }),
  component: AuthPage,
});

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;
const ID_REGEX = /^\d{5,15}$/;

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/auth" });
  const { data: company } = useCompanySettings({ allowUnscoped: true });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);

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
      toast.error("יש למלא מספר זהות וסיסמה");
      return;
    }
    if (!ID_REGEX.test(idNumber)) {
      toast.error("מספר זהות לא תקין");
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
          ? "מספר זהות או סיסמה שגויים"
          : error.message,
      );
      return;
    }
    toast.success("התחברת בהצלחה");
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
      toast.error("יש למלא את כל השדות");
      return;
    }
    if (!ID_REGEX.test(idNumber)) {
      toast.error("מספר זהות חייב להכיל ספרות בלבד (5–15 ספרות)");
      return;
    }
    if (password.length < 6) {
      toast.error("הסיסמה חייבת להכיל לפחות 6 תווים");
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
      toast.error(err instanceof Error ? err.message : "יצירת בעל המערכת נכשלה");
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
    toast.success("נוצר בעל המערכת הראשי. ברוך הבא!");
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
              <h1 className="text-2xl font-bold text-foreground">{APP_NAME}</h1>
              <p className="text-sm text-muted-foreground mt-1">{company?.company_name}</p>
            </div>
          </div>

          <Card className="card-elevated p-6">
            {showBootstrap ? (
              <>
                <div className="mb-5 text-center">
                  <h2 className="text-lg font-semibold">הקמת בעל המערכת הראשי</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    אין משתמשים במערכת. צור את חשבון בעל המערכת הראשי.
                  </p>
                </div>
                <form onSubmit={handleBootstrap} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="first-name-up">שם פרטי</Label>
                      <Input id="first-name-up" name="first_name" required maxLength={50} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last-name-up">שם משפחה</Label>
                      <Input id="last-name-up" name="last_name" required maxLength={50} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="id-up">מספר זהות</Label>
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
                    <Label htmlFor="pw-up">סיסמה</Label>
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
                    {loading ? <Loader2 className="size-4 animate-spin" /> : "צור בעל המערכת הראשי"}
                  </Button>
                </form>
              </>
            ) : (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="id-in">מספר זהות</Label>
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
                  <Label htmlFor="pw-in">סיסמה</Label>
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
                  {loading ? <Loader2 className="size-4 animate-spin" /> : "התחבר"}
                </Button>
                <p className="text-xs text-muted-foreground text-center pt-2">
                  אין לך חשבון? פנה לבעל המערכת הראשי לקבלת פרטי גישה.
                </p>
              </form>
            )}
          </Card>

          <p className="text-xs text-muted-foreground text-center mt-6">
            מערכת פנימית — שימוש מורשה בלבד.
          </p>
        </div>
      </div>
    </div>
  );
}
