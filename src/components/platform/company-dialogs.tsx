import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import { companyService, type Company } from "@/modules/companies";
import { usePlatformContext, useCompanyContext } from "@/platform";

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
  const [name, setName] = useState("");

  const mut = useMutation({
    mutationFn: () => companyService.createCompany(platform.id, name),
    onSuccess: async (company) => {
      toast.success("החברה נוצרה בהצלחה");
      await refresh();
      setActiveCompanyId(company.id);
      onOpenChange(false);
      setName("");
    },
    onError: (e: Error) => toast.error(e.message ?? "יצירת החברה נכשלה"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
          <div className="space-y-1">
            <Label htmlFor="company-create-name">שם החברה *</Label>
            <Input
              id="company-create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={mut.isPending || !name.trim()} className="gap-2">
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
  const [name, setName] = useState(company.name);

  const mut = useMutation({
    mutationFn: () => companyService.updateCompany(company.id, { name }),
    onSuccess: async () => {
      toast.success("החברה עודכנה");
      await refresh();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "העדכון נכשל"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>עריכת חברה</DialogTitle>
          <DialogDescription>עדכון שם החברה.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="company-edit-name">שם החברה *</Label>
          <Input
            id="company-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !name.trim()}
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
          <AlertDialogDescription>
            האם למחוק את החברה &quot;{company.name}&quot;? זו מחיקה רכה — ניתן לשחזר בעתיד.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
            disabled={mut.isPending}
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
