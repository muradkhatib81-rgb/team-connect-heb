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
      if (!picked) throw new Error(t("platformBranchDialogs.selectRequired"));
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
      toast.success(t("platformBranchDialogs.assignSuccess"));
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
          <DialogTitle>{t("platformBranchDialogs.createTitle")}</DialogTitle>
          <DialogDescription>{t("platformBranchDialogs.createDesc")}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">{t("platformBranchDialogs.noAvailable")}</p>
        ) : (
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder={t("platformBranchDialogs.selectPlaceholder")} />
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
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !selectedId || available.length === 0}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("platformBranchDialogs.assignSubmit")}
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
  const { t } = useTranslation();

  const realBranchesQuery = useQuery({
    queryKey: REAL_BRANCHES_QUERY_KEY,
    queryFn: listRealBranches,
    enabled: open,
  });
  const source = realBranchesQuery.data?.find((b) => b.id === branch.sourceBranchId) ?? null;

  const syncMut = useMutation({
    mutationFn: () => {
      if (!source) throw new Error(t("platformBranchDialogs.loadSourceFailed"));
      return branchService.refreshBranchSnapshot(branch.id, source);
    },
    onSuccess: async () => {
      toast.success(t("platformBranchDialogs.syncSuccess"));
      await queryClient.invalidateQueries({ queryKey: branchesQueryKey(branch.companyId) });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformBranchDialogs.syncFailed")),
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
          <DialogTitle>{t("platformBranchDialogs.editTitle", { name: branch.name })}</DialogTitle>
          <DialogDescription>{t("platformBranchDialogs.editDesc")}</DialogDescription>
        </DialogHeader>
        {realBranchesQuery.isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-0.5 text-sm rounded-lg border p-3">
            <InfoRow label={t("platformBranchDialogs.fields.name")} value={display.name} />
            <InfoRow label={t("platformBranchDialogs.fields.code")} value={display.code || "—"} />
            <InfoRow label={t("platformBranchDialogs.fields.address")} value={display.address || "—"} />
            <InfoRow
              label={t("platformBranchDialogs.fields.status")}
              value={
                display.is_active
                  ? t("platformBranchDialogs.statusActive")
                  : t("platformBranchDialogs.statusInactive")
              }
            />
            {!source && (
              <p className="text-xs text-destructive pt-2">{t("platformBranchDialogs.sourceNotFound")}</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
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
            {t("platformBranchDialogs.syncFromReal")}
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
  const { t } = useTranslation();

  const mut = useMutation({
    mutationFn: () => branchService.unassignBranch(branch.id),
    onSuccess: async () => {
      toast.success(t("platformBranchDialogs.unassignSuccess"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: branchesQueryKey(branch.companyId) }),
        queryClient.invalidateQueries({ queryKey: ALL_BRANCH_ASSIGNMENTS_QUERY_KEY }),
      ]);
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformBranchDialogs.actionFailed")),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("platformBranchDialogs.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("platformBranchDialogs.deleteDesc", { name: branch.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
            disabled={mut.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("platformBranchDialogs.unassignSubmit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
