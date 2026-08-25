import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UUID } from "@/core";
import { branchService, type Branch } from "@/modules/branches";
import { companyService } from "@/modules/companies";
import { branchesQueryKey, ALL_BRANCH_ASSIGNMENTS_QUERY_KEY } from "@/platform";
import { listRealBranches, REAL_BRANCHES_QUERY_KEY } from "@/lib/real-branches-directory";
import { syncBranchCompanyName, assignCompanyBranch } from "@/lib/branches.functions";
import { translateBillingError } from "@/lib/billing-errors";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";

// -------------------- Assign existing branch --------------------
// Deliberately not a "create" flow: Part 2 requires assigning an EXISTING
// real (single-tenant) branch to a Company, never recreating/duplicating
// one. Component name kept as `BranchCreateDialog` to avoid unrelated
// churn at every call site — see `modules/branches/branch.model.ts`.

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
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState("");
  const syncCompanyName = useServerFn(syncBranchCompanyName);
  const assignBranchFn = useServerFn(assignCompanyBranch);

  const realBranchesQuery = useQuery({
    queryKey: REAL_BRANCHES_QUERY_KEY,
    queryFn: listRealBranches,
    enabled: open,
  });
  const assignmentsQuery = useQuery({
    queryKey: ALL_BRANCH_ASSIGNMENTS_QUERY_KEY,
    queryFn: () => branchService.listAllBranches(),
    enabled: open,
  });

  const assignedSourceIds = useMemo(
    () => new Set((assignmentsQuery.data ?? []).map((b) => b.sourceBranchId)),
    [assignmentsQuery.data],
  );
  const available = useMemo(
    () => (realBranchesQuery.data ?? []).filter((b) => !assignedSourceIds.has(b.id)),
    [realBranchesQuery.data, assignedSourceIds],
  );

  const mut = useMutation({
    mutationFn: async () => {
      const picked = available.find((b) => b.id === selectedId);
      if (!picked) throw new Error("יש לבחור סניף קיים לשיוך.");
      const result = await assignBranchFn({
        data: {
          company_id: companyId,
          source_branch_id: picked.id,
          name: picked.name,
          code: picked.code ?? null,
          address: picked.address ?? null,
          is_active: picked.is_active ?? true,
        },
      });
      const company = await companyService.getCompany(companyId);
      if (company?.name?.trim()) {
        await syncCompanyName({
          data: { branch_id: picked.id, company_name: company.name.trim() },
        });
      }
      const row = result.branch as {
        id: string;
        company_id: string;
        source_branch_id: string;
        name: string;
        code: string | null;
        address: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      };
      const assigned: Branch = {
        id: row.id,
        companyId: row.company_id,
        sourceBranchId: row.source_branch_id,
        name: row.name,
        code: row.code,
        address: row.address,
        isActive: row.is_active,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
        deletedBy: null,
      };
      return assigned;
    },
    onSuccess: async (branch) => {
      toast.success("הסניף שויך לחברה בהצלחה");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: branchesQueryKey(companyId) }),
        queryClient.invalidateQueries({ queryKey: ALL_BRANCH_ASSIGNMENTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["company-settings"] }),
      ]);
      onOpenChange(false);
      setSelectedId("");
      onCreated?.(branch);
    },
    onError: (e: Error) => toast.error(translateBillingError(e.message ?? "", t)),
  });

  const isLoading = realBranchesQuery.isLoading || assignmentsQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>שיוך סניף קיים</DialogTitle>
          <DialogDescription>
            שיוך סניף קיים במערכת לחברה זו. הסניף ונתוניו (עובדים, מחלקות, סידורי עבודה וכו׳) נשארים
            ללא שינוי — נוצר קישור בלבד בין החברה לסניף.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            כל הסניפים הקיימים במערכת משויכים כבר לחברות בפלטפורמה. ניתן ליצור סניף חדש דרך ניהול
            סניפי המערכת.
          </p>
        ) : (
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="בחר סניף לשיוך" />
            </SelectTrigger>
            <SelectContent>
              {available.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                  {b.code ? ` (${b.code})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !selectedId || available.length === 0}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            שיוך הסניף
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- View / Sync --------------------
// A Platform Branch is only an assignment (see the model's doc comment);
// there is no independent "name" to rename here. This shows the live real
// branch details and lets the Platform Owner refresh the local snapshot.

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

  const realBranchesQuery = useQuery({
    queryKey: REAL_BRANCHES_QUERY_KEY,
    queryFn: listRealBranches,
    enabled: open,
  });
  const source = realBranchesQuery.data?.find((b) => b.id === branch.sourceBranchId) ?? null;

  const syncMut = useMutation({
    mutationFn: () => {
      if (!source) throw new Error("לא ניתן לטעון את פרטי הסניף המקורי כעת.");
      return branchService.refreshBranchSnapshot(branch.id, source);
    },
    onSuccess: async () => {
      toast.success("פרטי הסניף סונכרנו");
      await queryClient.invalidateQueries({ queryKey: branchesQueryKey(branch.companyId) });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "הסנכרון נכשל"),
  });

  const display = source ?? {
    name: branch.name,
    code: branch.code ?? "",
    address: branch.address,
    is_active: branch.isActive,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>פרטי סניף — {branch.name}</DialogTitle>
          <DialogDescription>
            פרטי הסניף המלאים (כולל עובדים, מחלקות וסידורי עבודה) מנוהלים בניהול סניפי המערכת. כאן
            ניתן לצפות בתמונת המצב וּלסנכרן אותה מהמידע האמיתי העדכני ביותר.
          </DialogDescription>
        </DialogHeader>
        {realBranchesQuery.isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-0.5 text-sm rounded-lg border p-3">
            <InfoRow label="שם" value={display.name} />
            <InfoRow label="קוד" value={display.code || "—"} />
            <InfoRow label="כתובת" value={display.address || "—"} />
            <InfoRow label="סטטוס" value={display.is_active ? "פעיל" : "לא פעיל"} />
            {!source && (
              <p className="text-xs text-destructive pt-2">
                לא נמצא הסניף המקורי במערכת (ייתכן שנמחק). מוצגת תמונת המצב האחרונה שנשמרה.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            סגירה
          </Button>
          <Button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending || !source}
            className="gap-2"
          >
            {syncMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            סנכרון מהסניף האמיתי
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b last:border-b-0 border-border/60">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate max-w-[220px]">{value}</span>
    </div>
  );
}

// -------------------- Unassign --------------------

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
    mutationFn: () => branchService.unassignBranch(branch.id),
    onSuccess: async () => {
      toast.success("שיוך הסניף לחברה הוסר");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: branchesQueryKey(branch.companyId) }),
        queryClient.invalidateQueries({ queryKey: ALL_BRANCH_ASSIGNMENTS_QUERY_KEY }),
      ]);
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message ?? "הפעולה נכשלה"),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>הסרת שיוך סניף</AlertDialogTitle>
          <AlertDialogDescription>
            האם להסיר את השיוך של הסניף &quot;{branch.name}&quot; לחברה? הפעולה מסירה רק את הקישור
            בין החברה לסניף — הסניף עצמו וכל הנתונים שבו (עובדים, מחלקות, סידורי עבודה וכו׳) יישארו
            קיימים במערכת ללא שינוי, וניתן לשייך אותו מחדש בכל עת.
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
            הסרת שיוך
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
