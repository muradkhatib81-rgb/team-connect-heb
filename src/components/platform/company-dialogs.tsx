import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { companyService, type Company, type CompanyStatus } from "@/modules/companies";
import { branchService } from "@/modules/branches";
import { usePlatformContext, useCompanyContext } from "@/platform";

const CURRENCIES = ["ILS", "USD", "EUR", "GBP"] as const;
const LANGUAGES: { value: string; label: string }[] = [
  { value: "he", label: "עברית" },
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];
const TIME_ZONES = [
  "Asia/Jerusalem",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export interface CompanyFormState {
  name: string;
  logoUrl: string;
  companyCode: string;
  legalName: string;
  taxNumber: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  language: string;
  timeZone: string;
}

function emptyForm(): CompanyFormState {
  return {
    name: "",
    logoUrl: "",
    companyCode: "",
    legalName: "",
    taxNumber: "",
    phone: "",
    email: "",
    address: "",
    currency: "ILS",
    language: "he",
    timeZone: "Asia/Jerusalem",
  };
}

function formFromCompany(company: Company): CompanyFormState {
  return {
    name: company.name,
    logoUrl: company.logoUrl ?? "",
    companyCode: company.companyCode ?? "",
    legalName: company.legalName ?? "",
    taxNumber: company.taxNumber ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    address: company.address ?? "",
    currency: company.currency,
    language: company.language,
    timeZone: company.timeZone,
  };
}

/** Shared field set for both Create and Edit — avoids duplicating the same ~10 inputs twice. */
function CompanyFormFields({
  idPrefix,
  form,
  onChange,
}: {
  idPrefix: string;
  form: CompanyFormState;
  onChange: (patch: Partial<CompanyFormState>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>שם החברה *</Label>
        <Input
          id={`${idPrefix}-name`}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={120}
          required
          autoFocus
        />
      </div>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-logo`}>כתובת לוגו (URL)</Label>
        <div className="flex items-center gap-2">
          <Avatar className="size-9 rounded-md shrink-0">
            <AvatarImage src={form.logoUrl || undefined} alt={form.name} />
            <AvatarFallback className="rounded-md bg-primary/10 text-primary">
              <Building2 className="size-4" />
            </AvatarFallback>
          </Avatar>
          <Input
            id={`${idPrefix}-logo`}
            value={form.logoUrl}
            onChange={(e) => onChange({ logoUrl: e.target.value })}
            maxLength={500}
            dir="ltr"
            placeholder="https://…"
            className="flex-1"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-code`}>קוד חברה</Label>
        <Input
          id={`${idPrefix}-code`}
          value={form.companyCode}
          onChange={(e) => onChange({ companyCode: e.target.value })}
          maxLength={40}
          className="font-mono"
          dir="ltr"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-legal-name`}>שם משפטי</Label>
        <Input
          id={`${idPrefix}-legal-name`}
          value={form.legalName}
          onChange={(e) => onChange({ legalName: e.target.value })}
          maxLength={160}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-tax`}>מספר עוסק / ח.פ.</Label>
        <Input
          id={`${idPrefix}-tax`}
          value={form.taxNumber}
          onChange={(e) => onChange({ taxNumber: e.target.value })}
          maxLength={40}
          dir="ltr"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-phone`}>טלפון</Label>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          maxLength={40}
          dir="ltr"
        />
      </div>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-email`}>אימייל</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          maxLength={160}
          dir="ltr"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-address`}>כתובת</Label>
        <Input
          id={`${idPrefix}-address`}
          value={form.address}
          onChange={(e) => onChange({ address: e.target.value })}
          maxLength={200}
        />
      </div>

      <div className="space-y-1">
        <Label>מטבע</Label>
        <Select value={form.currency} onValueChange={(v) => onChange({ currency: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>שפה</Label>
        <Select value={form.language} onValueChange={(v) => onChange({ language: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>אזור זמן</Label>
        <Select value={form.timeZone} onValueChange={(v) => onChange({ timeZone: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_ZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// -------------------- Create --------------------

export function CompanyCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { platform } = usePlatformContext();
  const { refresh, setActiveCompanyId } = useCompanyContext();
  const [form, setForm] = useState<CompanyFormState>(emptyForm);

  const mut = useMutation({
    mutationFn: () => companyService.createCompany(platform.id, form),
    onSuccess: async (company) => {
      toast.success("החברה נוצרה בהצלחה");
      await refresh();
      setActiveCompanyId(company.id);
      onOpenChange(false);
      setForm(emptyForm());
    },
    onError: (e: Error) => toast.error(e.message ?? "יצירת החברה נכשלה"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>חברה חדשה</DialogTitle>
          <DialogDescription>יצירת חברה חדשה בפלטפורמה.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
          className="space-y-3"
        >
          <CompanyFormFields
            idPrefix="company-create"
            form={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={mut.isPending || !form.name.trim()} className="gap-2">
              {mut.isPending && <Loader2 className="size-4 animate-spin" />}
              יצירה
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Edit --------------------

export function CompanyEditDialog({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  company: Company;
}) {
  const { refresh } = useCompanyContext();
  const [form, setForm] = useState<CompanyFormState>(() => formFromCompany(company));
  const [status, setStatus] = useState<CompanyStatus>(company.status);

  const mut = useMutation({
    mutationFn: async () => {
      const updated = await companyService.updateCompany(company.id, form);
      if (status !== company.status) {
        return companyService.setCompanyStatus(company.id, status);
      }
      return updated;
    },
    onSuccess: async () => {
      toast.success("החברה עודכנה");
      await refresh();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "העדכון נכשל"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>עריכת חברה</DialogTitle>
          <DialogDescription>עדכון פרטי החברה.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CompanyFormFields
            idPrefix="company-edit"
            form={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />
          <div className="space-y-1">
            <Label>סטטוס חברה</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as CompanyStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">פעילה</SelectItem>
                <SelectItem value="inactive">לא פעילה</SelectItem>
                <SelectItem value="suspended">מושהית</SelectItem>
              </SelectContent>
            </Select>
            {status !== "active" && (
              <p className="text-xs text-muted-foreground">
                חברה שאינה פעילה נשארת גלויה ברשימה אך לא ניתן להיכנס למצב סניף עבורה.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.name.trim()}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            שמירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Delete --------------------

export function CompanyDeleteDialog({
  open,
  onOpenChange,
  company,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  company: Company;
  onDeleted?: () => void;
}) {
  const { refresh } = useCompanyContext();

  const branchesQuery = useQuery({
    queryKey: ["company-delete-branch-count", company.id],
    queryFn: () => branchService.listBranches(company.id),
    enabled: open,
  });
  const branchCount = branchesQuery.data?.length ?? 0;
  const canDelete = !branchesQuery.isLoading && branchCount === 0;

  const mut = useMutation({
    mutationFn: () => companyService.deleteCompany(company.id),
    onSuccess: async () => {
      toast.success("החברה נמחקה");
      await refresh();
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message ?? "המחיקה נכשלה"),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת חברה</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>האם למחוק את החברה &quot;{company.name}&quot;? זו מחיקה רכה — ניתן לשחזר בעתיד.</p>
              {branchesQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">בודק סניפים משויכים…</p>
              ) : branchCount > 0 ? (
                <p className="text-xs font-medium text-destructive">
                  לא ניתן למחוק: לחברה זו משויכים {branchCount} סניפים. יש להסיר את השיוך של כל
                  הסניפים (בלשונית &quot;סניפים&quot;) לפני המחיקה.
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
            disabled={mut.isPending || !canDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            מחיקה
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
