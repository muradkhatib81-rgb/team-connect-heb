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
import { useCompanySettings } from "@/lib/use-company-settings";
import { Building2 } from "lucide-react";
import { Store, Loader2 } from "lucide-react";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  ssr: false,
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
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        const target = (search.redirect as string) || "/dashboard";
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
    setLoading(false);
    if (error) {
      toast.error(
        error.message === "Invalid login credentials"
          ? "מספר זהות או סיסמה שגויים"
          : error.message,
      );
      return;
    }
    toast.success("התחברת בהצלחה");
    const target = (search.redirect as string) || "/dashboard";
    router.history.replace(target.startsWith("/") ? target : "/dashboard");
  }

  async function handleBootstrap(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fullName = String(form.get("full_name") || "").trim();
    const idNumber = String(form.get("id_number") || "").trim();
    const password = String(form.get("password") || "");
    if (!fullName || !idNumber || !password) {
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
    const { error } = await supabase.auth.signUp({
      email: idEmail(idNumber),
      password,
      options: {
        data: {
          full_name: fullName,
          id_number: idNumber,
        },
      },
    });
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }
    // Auto-confirm is on — sign in immediately.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: idEmail(idNumber),
      password,
    });
    setLoading(false);
    if (signInErr) {
      toast.error(signInErr.message);
      return;
    }
    toast.success("נוצר מנהל ראשי. ברוך הבא!");
    navigate({ to: "/dashboard", replace: true });
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
            <div className="size-14 rounded-2xl gradient-brand flex items-center justify-center shadow-card">
              <Store className="size-7 text-primary-foreground" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground">{APP_NAME}</h1>
              <p className="text-sm text-muted-foreground mt-1">{BRANCH_NAME}</p>
            </div>
          </div>

          <Card className="card-elevated p-6">
            {showBootstrap ? (
              <>
                <div className="mb-5 text-center">
                  <h2 className="text-lg font-semibold">הקמת מנהל ראשי</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    אין משתמשים במערכת. צור את חשבון המנהל הראשי הראשון.
                  </p>
                </div>
                <form onSubmit={handleBootstrap} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name-up">שם מלא</Label>
                    <Input id="name-up" name="full_name" required maxLength={100} />
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
                    {loading ? <Loader2 className="size-4 animate-spin" /> : "צור מנהל ראשי"}
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
                  אין לך חשבון? פנה למנהל הראשי לקבלת פרטי גישה.
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
