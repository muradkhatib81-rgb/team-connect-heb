import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Crown, Info, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  createPlatformOwner,
  updatePlatformOwnerProfile,
  deletePlatformOwner,
  transferPrimaryOwnership,
  type PlatformOwnerRow,
} from "@/lib/platform-owners.functions";
import {
  PLATFORM_AUDIT_KEY,
  PLATFORM_OWNERS_KEY,
} from "@/lib/platform-owners.hooks";
import { splitFullName } from "@/lib/employee-name";

function useInvalidatePlatform() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [...PLATFORM_OWNERS_KEY] });
    qc.invalidateQueries({ queryKey: [...PLATFORM_AUDIT_KEY] });
  };
}

// -------------------- Create --------------------

export function PlatformOwnerCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePlatform();
  const createFn = useServerFn(createPlatformOwner);
  const [first_name, setFirstName] = useState("");
  const [last_name, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [id_number, setIdNumber] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || null,
          id_number: id_number.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("platformOwners.toasts.created"));
      invalidate();
      onOpenChange(false);
      setFirstName(""); setLastName(""); setEmail(""); setPassword(""); setPhone(""); setIdNumber("");
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformOwners.toasts.createFailed")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("platformOwners.dialogs.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("platformOwners.dialogs.createDesc")}
          </DialogDescription>
        </DialogHeader>
        {/* Hidden decoy fields deter aggressive browser autofill from populating
            the current user's identity into a form for creating a *different* person. */}
        <form
          autoComplete="off"
          onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
          className="space-y-3"
        >
          <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden />
          <input type="password" name="password" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden />
          <Field label={t("platformOwners.fields.firstName")} value={first_name} onChange={setFirstName} required autoComplete="off" name="po-first-name" />
          <Field label={t("platformOwners.fields.lastName")} value={last_name} onChange={setLastName} required autoComplete="off" name="po-last-name" />
          <Field label={t("platformOwners.fields.email")} type="email" value={email} onChange={setEmail} required autoComplete="off" name="po-email" />
          <Field label={t("platformOwners.fields.password")} type="password" value={password} onChange={setPassword} required autoComplete="new-password" name="po-password" />
          <Field label={t("platformOwners.fields.phone")} value={phone} onChange={setPhone} autoComplete="off" name="po-phone" />
          <Field label={t("platformOwners.fields.idNumber")} value={id_number} onChange={setIdNumber} autoComplete="off" name="po-id-number" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button
              type="submit"
              disabled={mut.isPending || first_name.trim().length < 1 || last_name.trim().length < 1 || !email || password.length < 8}
              className="gap-2"
            >
              {mut.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("platformOwners.dialogs.createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Edit profile --------------------

export function PlatformOwnerEditDialog({
  open,
  onOpenChange,
  owner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  owner: PlatformOwnerRow;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePlatform();
  const updateFn = useServerFn(updatePlatformOwnerProfile);
  const ownerNames = owner.first_name || owner.last_name
    ? { first_name: owner.first_name, last_name: owner.last_name }
    : splitFullName(owner.full_name);
  const [first_name, setFirstName] = useState(ownerNames.first_name);
  const [last_name, setLastName] = useState(ownerNames.last_name);
  const [phone, setPhone] = useState(owner.phone ?? "");
  const [id_number, setIdNumber] = useState(owner.id_number ?? "");

  const mut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          user_id: owner.user_id,
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          phone: phone.trim() || null,
          id_number: id_number.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("platformOwners.toasts.updated"));
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformOwners.toasts.updateFailed")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("platformOwners.dialogs.editTitle")}</DialogTitle>
          <DialogDescription>{t("platformOwners.dialogs.editDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("platformOwners.fields.firstName")} value={first_name} onChange={setFirstName} required />
          <Field label={t("platformOwners.fields.lastName")} value={last_name} onChange={setLastName} required />
          <div className="space-y-1">
            <Label>{t("platformOwners.fields.email")}</Label>
            <Input value={owner.email ?? ""} disabled readOnly dir="ltr" />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Info className="size-3" />
              {t("platformOwners.detail.emailFutureHint")}
            </p>
          </div>
          <Field label={t("platformOwners.fields.phone")} value={phone} onChange={setPhone} />
          <Field label={t("platformOwners.fields.idNumber")} value={id_number} onChange={setIdNumber} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || first_name.trim().length < 1 || last_name.trim().length < 1}
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

export function PlatformOwnerDeleteDialog({
  open,
  onOpenChange,
  owner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  owner: PlatformOwnerRow;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePlatform();
  const deleteFn = useServerFn(deletePlatformOwner);
  const [confirm, setConfirm] = useState("");

  const mut = useMutation({
    mutationFn: () => deleteFn({ data: { user_id: owner.user_id } }),
    onSuccess: () => {
      toast.success(t("platformOwners.toasts.deleted"));
      invalidate();
      onOpenChange(false);
      setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformOwners.toasts.deleteFailed")),
  });

  const canConfirm = !!owner.email && confirm.trim().toLowerCase() === owner.email.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setConfirm(""); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("platformOwners.dialogs.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("platformOwners.dialogs.deleteDesc")}</DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{t("platformOwners.dialogs.warning")}</AlertTitle>
          <AlertDescription>
            {t("platformOwners.dialogs.deleteWarning")}
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          <p className="text-sm">
            {t("platformOwners.dialogs.deleteConfirm")}{" "}
            <span className="font-mono" dir="ltr">{owner.email}</span>
          </p>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || mut.isPending}
            onClick={() => mut.mutate()}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("platformOwners.dialogs.deleteSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Transfer Primary Ownership --------------------

export function PlatformOwnerTransferDialog({
  open,
  onOpenChange,
  owners,
  currentPrimary,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  owners: PlatformOwnerRow[];
  currentPrimary: PlatformOwnerRow | null;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePlatform();
  const transferFn = useServerFn(transferPrimaryOwnership);
  const [targetId, setTargetId] = useState<string>("");
  const [confirm, setConfirm] = useState("");

  const eligible = owners.filter((o) => o.level !== "primary" && o.is_active);
  const target = eligible.find((o) => o.user_id === targetId) ?? null;
  const canConfirm =
    !!target && !!target.email && confirm.trim().toLowerCase() === target.email.toLowerCase();

  const mut = useMutation({
    mutationFn: () => transferFn({ data: { user_id: targetId } }),
    onSuccess: () => {
      toast.success(t("platformOwners.toasts.transferred"));
      invalidate();
      onOpenChange(false);
      setTargetId(""); setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformOwners.toasts.transferFailed")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) { setTargetId(""); setConfirm(""); }
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="size-5 text-amber-500" />
            {t("platformOwners.dialogs.transferTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("platformOwners.dialogs.transferDesc")}
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{t("platformOwners.dialogs.transferIrreversible")}</AlertTitle>
          <AlertDescription>
            {t("platformOwners.dialogs.transferWarning", {
              current: currentPrimary?.full_name ?? t("platformOwners.badges.primary"),
            })}
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("platformOwners.dialogs.transferTarget")}</Label>
            <Select value={targetId} onValueChange={(v) => { setTargetId(v); setConfirm(""); }}>
              <SelectTrigger><SelectValue placeholder={t("platformOwners.dialogs.transferSelectPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {eligible.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    {t("platformOwners.dialogs.transferNoEligible")}
                  </div>
                ) : eligible.map((o) => (
                  <SelectItem key={o.user_id} value={o.user_id}>
                    {o.full_name}{o.email ? ` · ${o.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {target && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
              <p className="text-sm">
                {t("platformOwners.dialogs.transferResult", { name: target.full_name })}
              </p>
              <div className="space-y-1">
                <Label className="text-xs">{t("platformOwners.dialogs.transferConfirmLabel")}</Label>
                <p className="text-xs font-mono text-muted-foreground" dir="ltr">{target.email}</p>
                <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || mut.isPending}
            onClick={() => mut.mutate()}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("platformOwners.dialogs.transferSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Small helpers --------------------

function Field({
  label, value, onChange, type = "text", required, autoComplete, name,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  name?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}{required ? " *" : ""}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        name={name}
      />
    </div>
  );
}
