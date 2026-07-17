import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { UUID } from "@/core";
import { branchService, type Branch } from "@/modules/branches";
import { branchesQueryKey } from "@/platform";

// -------------------- Create --------------------

export function BranchCreateDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: UUID;
  onCreated?: (branch: Branch) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const mut = useMutation({
    mutationFn: () => branchService.createBranch(companyId, name),
    onSuccess: async (branch) => {
      toast.success("הסניף נוצר בהצלחה");
      await queryClient.invalidateQueries({ queryKey: branchesQueryKey(companyId) });
      onOpenChange(false);
      setName("");
      onCreated?.(branch);
    },
    onError: (e: Error) => toast.error(e.message ?? "יצירת הסניף נכשלה"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>סניף חדש</DialogTitle>
          <DialogDescription>יצירת סניף חדש עבור החברה.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="branch-create-name">שם הסניף *</Label>
            <Input
              id="branch-create-name"
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

export function BranchEditDialog({
  open,
  onOpenChange,
  branch,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branch: Branch;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(branch.name);

  const mut = useMutation({
    mutationFn: () => branchService.updateBranch(branch.id, { name }),
    onSuccess: async () => {
      toast.success("הסניף עודכן");
      await queryClient.invalidateQueries({ queryKey: branchesQueryKey(branch.companyId) });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "העדכון נכשל"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>עריכת סניף</DialogTitle>
          <DialogDescription>עדכון שם הסניף.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="branch-edit-name">שם הסניף *</Label>
          <Input
            id="branch-edit-name"
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

export function BranchDeleteDialog({
  open,
  onOpenChange,
  branch,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branch: Branch;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: () => branchService.deleteBranch(branch.id),
    onSuccess: async () => {
      toast.success("הסניף נמחק");
      await queryClient.invalidateQueries({ queryKey: branchesQueryKey(branch.companyId) });
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message ?? "המחיקה נכשלה"),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת סניף</AlertDialogTitle>
          <AlertDialogDescription>
            האם למחוק את הסניף &quot;{branch.name}&quot;? זו מחיקה רכה — ניתן לשחזר בעתיד.
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
