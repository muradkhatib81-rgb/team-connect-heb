import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { APP_NAME, BRANCH_NAME } from "@/lib/constants";
import { Store, Loader2 } from "lucide-react";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: `התחברות | ${APP_NAME}` }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: (search.redirect as any) || "/dashboard", replace: true });
      else setChecking(false);
    });
  }, [navigate, search.redirect]);

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    if (!email || !password) {
      toast.error("יש למלא אימייל וסיסמה");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message === "Invalid login credentials" ? "פרטי התחברות שגויים" : error.message);
      return;
    }
    toast.success("התחברת בהצלחה");
    navigate({ to: (search.redirect as any) || "/dashboard", replace: true });
  }

  async function handleSignUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const fullName = String(form.get("full_name") || "").trim();
    if (!email || !password || !fullName) {
      toast.error("יש למלא את כל השדות");
      return;
    }
    if (password.length < 6) {
      toast.error("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("החשבון נוצר. ניתן להתחבר.");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

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
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="signin">התחברות</TabsTrigger>
                <TabsTrigger value="signup">חשבון חדש</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email-in">אימייל</Label>
                    <Input id="email-in" name="email" type="email" autoComplete="email" required dir="ltr" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pw-in">סיסמה</Label>
                    <Input id="pw-in" name="password" type="password" autoComplete="current-password" required dir="ltr" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading} size="lg">
                    {loading ? <Loader2 className="size-4 animate-spin" /> : "התחבר"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name-up">שם מלא</Label>
                    <Input id="name-up" name="full_name" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-up">אימייל</Label>
                    <Input id="email-up" name="email" type="email" autoComplete="email" required dir="ltr" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pw-up">סיסמה</Label>
                    <Input id="pw-up" name="password" type="password" autoComplete="new-password" minLength={6} required dir="ltr" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading} size="lg">
                    {loading ? <Loader2 className="size-4 animate-spin" /> : "צור חשבון"}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    המשתמש הראשון שיירשם הופך אוטומטית למנהל ראשי.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </Card>

          <p className="text-xs text-muted-foreground text-center mt-6">
            מערכת פנימית — שימוש מורשה בלבד.
          </p>
        </div>
      </div>
    </div>
  );
}
