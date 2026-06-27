import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useCompanySettings } from "@/lib/use-company-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, Building2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/company-settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "הגדרות חברה" }] }),
  component: CompanySettingsPage,
});

const MAX_LOGO_BYTES = 500 * 1024; // 500 KB

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function CompanySettingsPage() {
  const { data: profile, isLoading: profileLoading } = useAuth();
  const { data: company, isLoading } = useCompanySettings();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    company_name: "",
    address: "",
    phone: "",
    email: "",
    primary_color: "",
    logo_url: "" as string | null | "",
  });

  const isMainAdmin = !!profile?.roles?.includes("main_admin");

  useEffect(() => {
    if (company) {
      setForm({
        company_name: company.company_name ?? "",
        address: company.address ?? "",
        phone: company.phone ?? "",
        email: company.email ?? "",
        primary_color: company.primary_color ?? "",
        logo_url: company.logo_url ?? "",
      });
    }
  }, [company?.id]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.company_name.trim()) throw new Error("שם החברה הוא שדה חובה");
      const payload = {
        company_name: form.company_name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        primary_color: form.primary_color.trim() || null,
        logo_url: form.logo_url || null,
      };
      if (company?.id) {
        const { error } = await supabase
          .from("company_settings" as any)
          .update(payload)
          .eq("id", company.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("company_settings" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("הגדרות החברה נשמרו");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שמירה נכשלה"),
  });

  async function handleLogoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("יש לבחור קובץ תמונה");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("גודל הלוגו עד 500KB");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setForm((f) => ({ ...f, logo_url: dataUrl }));
    } catch {
      toast.error("טעינת הקובץ נכשלה");
    }
  }

  if (isLoading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isMainAdmin) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl gradient-brand flex items-center justify-center">
          <Building2 className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">הגדרות חברה</h1>
          <p className="text-sm text-muted-foreground">
            ניהול שם החברה, לוגו ופרטי קשר. הנתונים מתעדכנים אוטומטית בכל המערכת.
          </p>
        </div>
      </div>

      <Card className="card-elevated p-6 space-y-5">
        <div className="space-y-2">
          <Label>לוגו החברה</Label>
          <div className="flex items-center gap-4">
            <div className="size-20 rounded-xl border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
              {form.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logo_url} alt="לוגו" className="size-full object-contain" />
              ) : (
                <Building2 className="size-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoFile(f);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4 ml-1" />
                העלאת לוגו
              </Button>
              {form.logo_url ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, logo_url: "" }))}
                >
                  <Trash2 className="size-4 ml-1" />
                  הסר לוגו
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">PNG/JPG עד 500KB. מומלץ ריבועי.</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="company_name">שם החברה *</Label>
          <Input
            id="company_name"
            value={form.company_name}
            onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
            maxLength={120}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">כתובת החברה</Label>
          <Textarea
            id="address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            rows={2}
            maxLength={300}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="phone">מספר טלפון</Label>
            <Input
              id="phone"
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              maxLength={30}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">דוא"ל החברה</Label>
            <Input
              id="email"
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              maxLength={120}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="primary_color">צבע ראשי (אופציונלי)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="primary_color"
              type="color"
              value={form.primary_color || "#000000"}
              onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
              className="w-20 h-10 p-1"
            />
            <Input
              dir="ltr"
              value={form.primary_color}
              placeholder="#3B82F6"
              onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
              maxLength={20}
              className="flex-1"
            />
            {form.primary_color ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, primary_color: "" }))}
              >
                נקה
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="lg">
            {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : "שמירת שינויים"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
