import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
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
import { syncBranchCompanyName } from "@/lib/branches.functions";
import { usePlatformContext, useCompanyContext } from "@/platform";

const CURRENCIES = ["ILS", "USD", "EUR", "GBP"] as const;
const LANGUAGE_CODES = ["he", "en", "ar"] as const;
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
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>{t("platformCompanyDialogs.fields.name")}</Label>
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
        <Label htmlFor={`${idPrefix}-logo`}>{t("platformCompanyDialogs.fields.logoUrl")}</Label>
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
        <Label htmlFor={`${idPrefix}-code`}>{t("platformCompanyDialogs.fields.companyCode")}</Label>
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
        <Label htmlFor={`${idPrefix}-legal-name`}>{t("platformCompanyDialogs.fields.legalName")}</Label>
        <Input
          id={`${idPrefix}-legal-name`}
          value={form.legalName}
          onChange={(e) => onChange({ legalName: e.target.value })}
          maxLength={160}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-tax`}>{t("platformCompanyDialogs.fields.taxNumber")}</Label>
        <Input
          id={`${idPrefix}-tax`}
          value={form.taxNumber}
          onChange={(e) => onChange({ taxNumber: e.target.value })}
          maxLength={40}
          dir="ltr"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-phone`}>{t("platformCompanyDialogs.fields.phone")}</Label>
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
        <Label htmlFor={`${idPrefix}-email`}>{t("platformCompanyDialogs.fields.email")}</Label>
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
        <Label htmlFor={`${idPrefix}-address`}>{t("platformCompanyDialogs.fields.address")}</Label>
        <Input
          id={`${idPrefix}-address`}
          value={form.address}
          onChange={(e) => onChange({ address: e.target.value })}
          maxLength={200}
        />
      </div>

      <div className="space-y-1">
        <Label>{t("platformCompanyDialogs.fields.currency")}</Label>
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
        <Label>{t("platformCompanyDialogs.fields.language")}</Label>
        <Select value={form.language} onValueChange={(v) => onChange({ language: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_CODES.map((code) => (
              <SelectItem key={code} value={code}>
                {t(`contentTranslation.lang.${code}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>{t("platformCompanyDialogs.fields.timeZone")}</Label>
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
  const { t } = useTranslation();
  const { platform } = usePlatformContext();
  const { refresh, setActiveCompanyId } = useCompanyContext();
  const [form, setForm] = useState<CompanyFormState>(emptyForm);

  const mut = useMutation({
    mutationFn: () => companyService.createCompany(platform.id, form),
    onSuccess: async (company) => {
      toast.success(t("platformCompanyDialogs.create.success"));
      await refresh();
      setActiveCompanyId(company.id);
      onOpenChange(false);
      setForm(emptyForm());
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformCompanyDialogs.create.failed")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("platformCompanyDialogs.create.title")}</DialogTitle>
          <DialogDescription>{t("platformCompanyDialogs.create.desc")}</DialogDescription>
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
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={mut.isPending || !form.name.trim()} className="gap-2">
              {mut.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("platformCompanyDialogs.create.submit")}
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
  const { t } = useTranslation();
  const { refresh } = useCompanyContext();
  const [form, setForm] = useState<CompanyFormState>(() => formFromCompany(company));
  const [status, setStatus] = useState<CompanyStatus>(company.status);
  const syncCompanyName = useServerFn(syncBranchCompanyName);

  const mut = useMutation({
    mutationFn: async () => {
      const updated = await companyService.updateCompany(company.id, form);
      if (status !== company.status) {
        await companyService.setCompanyStatus(company.id, status);
      }
      // Keep branch-scoped company_settings.company_name aligned with the
      // Platform company name (never the branch/store name).
      const assignments = await branchService.listBranches(company.id);
      const name = form.name.trim();
      if (name) {
        await Promise.all(
          assignments.map((b) =>
            syncCompanyName({
              data: { branch_id: b.sourceBranchId, company_name: name },
            }),
          ),
        );
      }
      return updated;
    },
    onSuccess: async () => {
      toast.success(t("platformCompanyDialogs.edit.success"));
      await refresh();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformCompanyDialogs.edit.failed")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("platformCompanyDialogs.edit.title")}</DialogTitle>
          <DialogDescription>{t("platformCompanyDialogs.edit.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CompanyFormFields
            idPrefix="company-edit"
            form={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />
          <div className="space-y-1">
            <Label>{t("platformCompanyDialogs.fields.status")}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as CompanyStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("platformCompanies.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("platformCompanies.statusInactive")}</SelectItem>
                <SelectItem value="suspended">{t("platformCompanies.statusSuspended")}</SelectItem>
              </SelectContent>
            </Select>
            {status !== "active" && (
              <p className="text-xs text-muted-foreground">{t("platformCompanyDialogs.statusHint")}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.name.trim()}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("common.save")}
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
  const { t } = useTranslation();
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
      toast.success(t("platformCompanyDialogs.delete.success"));
      await refresh();
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformCompanyDialogs.delete.failed")),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("platformCompanyDialogs.delete.title")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{t("platformCompanyDialogs.delete.desc", { name: company.name })}</p>
              {branchesQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">
                  {t("platformCompanyDialogs.delete.checkingBranches")}
                </p>
              ) : branchCount > 0 ? (
                <p className="text-xs font-medium text-destructive">
                  {t("platformCompanyDialogs.delete.blocked", { count: branchCount })}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
            disabled={mut.isPending || !canDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
