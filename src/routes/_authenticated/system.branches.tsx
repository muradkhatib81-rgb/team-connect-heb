import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Plus, Pencil, Trash2, UserCog, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  listBranchesWithStats,
  listEmployeesForManagerPicker,
  createBranch,
  updateBranch,
  deleteBranch,
  getBranchDeleteBlockers,
  assignBranchManager,
} from "@/lib/branches.functions";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useCompanyContext } from "@/platform";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Branch = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  manager_id: string | null;
  manager_name: string | null;
  employees_count: number;
  departments_count: number;
  active_schedules_count: number;
};

type SortKey = "name" | "code" | "employees" | "departments" | "created";
type FilterStatus = "all" | "active" | "inactive";

export const Route = createFileRoute("/_authenticated/system/branches")({
  component: BranchesPage,
});

function BranchesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useServerFn(listBranchesWithStats);
  const { setActiveBranchId } = useActiveBranch();
  const { activeCompany } = useCompanyContext();

  const branchesQ = useQuery({
    queryKey: ["system", "branches"],
    queryFn: () => list({}),
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FilterStatus>("all");
  const [sort, setSort] = useState<SortKey>("created");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [managing, setManaging] = useState<Branch | null>(null);

  const branches = (branchesQ.data ?? []) as Branch[];

  const filtered = useMemo(() => {
    let arr = branches.filter((b) => {
      if (status === "active" && !b.is_active) return false;
      if (status === "inactive" && b.is_active) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        (b.address ?? "").toLowerCase().includes(q) ||
        (b.phone ?? "").toLowerCase().includes(q) ||
        (b.manager_name ?? "").toLowerCase().includes(q)
      );
    });
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case "name": return a.name.localeCompare(b.name, "he");
        case "code": return a.code.localeCompare(b.code);
        case "employees": return b.employees_count - a.employees_count;
        case "departments": return b.departments_count - a.departments_count;
        case "created":
        default:
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
    });
    return arr;
  }, [branches, search, status, sort]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-xl gradient-brand flex items-center justify-center shadow-soft">
            <Building2 className="size-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("systemBranchesPage.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("systemBranchesPage.subtitle")}</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> {t("systemBranchesPage.newBranch")}
        </Button>
      </div>

      <Card className="p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="relative">
            <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("systemBranchesPage.searchPlaceholder")}
              className="pr-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as FilterStatus)}>
            <SelectTrigger><SelectValue placeholder={t("profile.status")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("systemBranchesPage.allStatuses")}</SelectItem>
              <SelectItem value="active">{t("profile.active")}</SelectItem>
              <SelectItem value="inactive">{t("profile.inactive")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger><SelectValue placeholder={t("dashboard.sort")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created">{t("systemBranchesPage.sortCreated")}</SelectItem>
              <SelectItem value="name">{t("systemBranchesPage.sortName")}</SelectItem>
              <SelectItem value="code">{t("systemBranchesPage.sortCode")}</SelectItem>
              <SelectItem value="employees">{t("systemBranchesPage.sortEmployees")}</SelectItem>
              <SelectItem value="departments">{t("systemBranchesPage.sortDepartments")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {branchesQ.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">{t("systemBranchesPage.noBranches")}</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((b) => (
            <Card key={b.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-lg truncate">{b.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{b.code}</div>
                </div>
                <Badge variant={b.is_active ? "default" : "secondary"}>
                  {b.is_active ? t("profile.active") : t("profile.inactive")}
                </Badge>
              </div>
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">{t("systemBranchesPage.addressLabel")} </span>{b.address || "—"}</div>
                <div><span className="text-muted-foreground">{t("systemBranchesPage.phoneLabel")} </span>{b.phone || "—"}</div>
                <div><span className="text-muted-foreground">{t("systemBranchesPage.branchManagerLabel")} </span>{b.manager_name || "—"}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm border-t pt-3">
                <div>
                  <div className="font-bold">{b.employees_count}</div>
                  <div className="text-xs text-muted-foreground">{t("systemBranchesPage.employees")}</div>
                </div>
                <div>
                  <div className="font-bold">{b.departments_count}</div>
                  <div className="text-xs text-muted-foreground">{t("systemBranchesPage.departments")}</div>
                </div>
                <div>
                  <div className="font-bold">{b.active_schedules_count}</div>
                  <div className="text-xs text-muted-foreground">{t("systemBranchesPage.activeSchedules")}</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("systemBranchesPage.createdAt")} {new Date(b.created_at).toLocaleDateString("he-IL")}
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" onClick={() => setEditing(b)}>
                  <Pencil className="size-3.5" /> {t("common.edit")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setManaging(b)}>
                  <UserCog className="size-3.5" /> {t("systemBranchesPage.branchManagerAction")}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setDeleting(b)}>
                  <Trash2 className="size-3.5" /> {t("common.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <BranchFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        branches={branches}
        companyName={activeCompany?.name ?? null}
        onCreated={(branchId) => {
          setActiveBranchId(branchId);
          qc.invalidateQueries({ queryKey: ["system", "branches"] });
          qc.invalidateQueries({ queryKey: ["active-branch"] });
          qc.invalidateQueries({ queryKey: ["departments"] });
          qc.invalidateQueries({ queryKey: ["departments-list"] });
          qc.invalidateQueries({ queryKey: ["company-settings"] });
        }}
      />

      {editing && (
        <BranchFormDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          branch={editing}
          onUpdated={() => {
            qc.invalidateQueries({ queryKey: ["system", "branches"] });
            setEditing(null);
          }}
        />
      )}

      {managing && (
        <ManagerDialog
          branch={managing}
          onClose={() => setManaging(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["system", "branches"] });
            setManaging(null);
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          branch={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["system", "branches"] });
            setDeleting(null);
          }}
        />
      )}

    </div>
  );
}

function BranchFormDialog({
  open,
  onOpenChange,
  branch,
  branches = [],
  companyName = null,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branch?: Branch;
  branches?: Branch[];
  /** Platform company name → company_settings.company_name (never the branch name). */
  companyName?: string | null;
  onCreated?: (branchId: string) => void;
  onUpdated?: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!branch;
  const create = useServerFn(createBranch);
  const update = useServerFn(updateBranch);

  const [name, setName] = useState(branch?.name ?? "");
  const [code, setCode] = useState(branch?.code ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [isActive, setIsActive] = useState(branch?.is_active ?? true);
  const [copyMode, setCopyMode] = useState<"empty" | "copy">("empty");
  const [sourceBranchId, setSourceBranchId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setName(branch?.name ?? "");
    setCode(branch?.code ?? "");
    setAddress(branch?.address ?? "");
    setPhone(branch?.phone ?? "");
    setIsActive(branch?.is_active ?? true);
    setCopyMode("empty");
    setSourceBranchId("");
  }, [open, branch]);

  const m = useMutation({
    mutationFn: async () => {
      if (isEdit && branch) {
        return update({
          data: {
            id: branch.id,
            name: name.trim(),
            code: code.trim(),
            address: address.trim() || null,
            phone: phone.trim() || null,
            is_active: isActive,
          },
        });
      }
      return create({
        data: {
          name: name.trim(),
          code: code.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          is_active: isActive,
          copy_departments_from_branch_id:
            copyMode === "copy" && sourceBranchId ? sourceBranchId : null,
          company_name: companyName?.trim() || null,
        },
      });
    },
    onSuccess: (res: any) => {
      if (isEdit) {
        toast.success(t("systemBranchesPage.updated"));
        onUpdated?.();
      } else {
        const copied = res?.departments_copied ?? 0;
        toast.success(
          copied > 0
            ? t("systemBranchesPage.createdWithDepartments", { count: copied })
            : t("systemBranchesPage.created"),
        );
        if (res?.id) onCreated?.(res.id as string);
      }
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("systemBranchesPage.editTitle") : t("systemBranchesPage.newBranch")}</DialogTitle>
          <DialogDescription>{t("systemBranchesPage.formDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t("systemBranchesPage.branchName")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div>
            <Label>{t("systemBranchesPage.branchCode")}</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} className="font-mono" />
          </div>
          <div>
            <Label>{t("platformBranches.stats.address")}</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label>{t("profile.phone")}</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium">{t("profile.status")}</div>
              <div className="text-xs text-muted-foreground">{t("systemBranchesPage.inactiveHint")}</div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          {!isEdit && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="font-medium">{t("systemBranchesPage.deptStructure")}</div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="copyMode"
                    checked={copyMode === "empty"}
                    onChange={() => setCopyMode("empty")}
                  />
                  {t("systemBranchesPage.emptyBranch")}
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="copyMode"
                    checked={copyMode === "copy"}
                    onChange={() => setCopyMode("copy")}
                  />
                  {t("systemBranchesPage.copyFromExisting")}
                </label>
              </div>
              {copyMode === "copy" && (
                <Select value={sourceBranchId} onValueChange={setSourceBranchId}>
                  <SelectTrigger><SelectValue placeholder={t("systemBranchesPage.selectSourceBranch")} /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {t("systemBranchesPage.sourceBranchOption", {
                          name: b.name,
                          count: b.departments_count,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {copyMode === "copy" && (
                <p className="text-xs text-muted-foreground">
                  {t("systemBranchesPage.copyHint")}
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={() => m.mutate()}
            disabled={
              m.isPending ||
              !name.trim() ||
              !code.trim() ||
              (!isEdit && copyMode === "copy" && !sourceBranchId)
            }
          >
            {m.isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? t("systemBranchesPage.saveChanges") : t("systemBranchesPage.createBranch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManagerDialog({
  branch,
  onClose,
  onSaved,
}: {
  branch: Branch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const listEmp = useServerFn(listEmployeesForManagerPicker);
  const assign = useServerFn(assignBranchManager);
  const empQ = useQuery({
    queryKey: ["system", "branches", "manager-picker"],
    queryFn: () => listEmp({}),
  });
  const [managerId, setManagerId] = useState<string>(branch.manager_id ?? "__none__");

  const m = useMutation({
    mutationFn: () =>
      assign({
        data: {
          branch_id: branch.id,
          manager_id: managerId === "__none__" ? null : managerId,
        },
      }),
    onSuccess: () => {
      toast.success(t("systemBranchesPage.managerUpdated"));
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.error")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{t("systemBranchesPage.managerDialogTitle", { name: branch.name })}</DialogTitle>
          <DialogDescription>{t("systemBranchesPage.oneManagerRule")}</DialogDescription>
        </DialogHeader>
        {empQ.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <Select value={managerId} onValueChange={setManagerId}>
            <SelectTrigger><SelectValue placeholder={t("common.select")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("systemBranchesPage.noBranchManager")}</SelectItem>
              {((empQ.data ?? []) as any[]).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  branch,
  onClose,
  onDeleted,
}: {
  branch: Branch;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const del = useServerFn(deleteBranch);
  const fetchBlockers = useServerFn(getBranchDeleteBlockers);
  const blockersQ = useQuery({
    queryKey: ["branch-delete-blockers", branch.id],
    queryFn: () => fetchBlockers({ data: { id: branch.id } }),
    staleTime: 0,
  });

  const data = blockersQ.data;
  const operationalRows: { label: string; value: number }[] = [
    { label: t("systemBranchesPage.blockerEmployees"), value: data?.employees ?? 0 },
    { label: t("systemBranchesPage.blockerSchedules"), value: data?.schedules ?? 0 },
    { label: t("systemBranchesPage.blockerReports"), value: data?.reports ?? 0 },
    { label: t("systemBranchesPage.blockerTasks"), value: data?.tasks ?? 0 },
    { label: t("systemBranchesPage.blockerMessages"), value: data?.messages ?? 0 },
    { label: t("systemBranchesPage.blockerNotifications"), value: data?.notifications ?? 0 },
  ];
  const loading = blockersQ.isLoading;
  const loadError = data?.ok === false ? data.error : null;
  const canDelete = data?.ok === true && (data.canDelete ?? false);
  const onlyDepartments = data?.ok === true && (data.onlyDepartments ?? false);
  const isEmpty = data?.ok === true && (data.isEmpty ?? false);
  const departmentsCount = data?.departments ?? 0;

  const m = useMutation({
    mutationFn: () =>
      del({
        data: {
          id: branch.id,
          ...(onlyDepartments ? { confirm_cascade: true as const } : {}),
        },
      }),
    onSuccess: (res: any) => {
      if (res?.ok && res?.deleted) {
        if ((res?.departmentsDeleted ?? 0) > 0) {
          toast.success(
            t("systemBranchesPage.deletedWithDepts", {
              name: branch.name,
              count: res.departmentsDeleted,
            }),
          );
        } else {
          toast.success(t("systemBranchesPage.deletedSuccess", { name: branch.name }));
        }
        onDeleted();
        return;
      }
      const message =
        (typeof res?.message === "string" && res.message.trim()) ||
        t("systemBranchesPage.deleteBlocked");
      const [first, ...rest] = message.split("\n");
      toast.error(first, {
        description: rest.length ? rest.join("\n") : undefined,
        duration: 8000,
      });
    },
    onError: (e: any) => {
      console.error("[DeleteBranch] unexpected error:", e);
      toast.error(t("systemBranchesPage.deleteUnexpectedError"), {
        duration: 8000,
      });
    },
  });

  let actionLabel = t("systemBranchesPage.deleteBranch");
  if (onlyDepartments) actionLabel = t("systemBranchesPage.deleteBranchAndDepts");

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("systemBranchesPage.deleteTitle", { name: branch.name })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("systemBranchesPage.checkingLinkedData")}
                </div>
              )}

              {!loading && loadError && (
                <div className="text-destructive">{loadError}</div>
              )}

              {!loading && !loadError && isEmpty && (
                <div>{t("systemBranchesPage.emptyBranchDelete")}</div>
              )}

              {!loading && !loadError && onlyDepartments && (
                <div className="space-y-2">
                  <div className="font-medium text-foreground">
                    {t("systemBranchesPage.onlyDepartmentsDelete", { count: departmentsCount })}
                  </div>
                  <div>
                    {t("systemBranchesPage.confirmDeleteWithDepts")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("systemBranchesPage.deleteCascadeHint")}
                  </div>
                </div>
              )}

              {!loading && !loadError && !canDelete && (
                <div className="space-y-2">
                  <div className="font-medium text-foreground">
                    {t("systemBranchesPage.cannotDeleteOperational")}
                  </div>
                  <ul className="space-y-1 rounded-md border bg-muted/40 p-3 text-foreground">
                    {operationalRows.map((r) => (
                      <li
                        key={r.label}
                        className="flex items-center justify-between"
                      >
                        <span>• {r.label}</span>
                        <span
                          className={
                            r.value > 0 ? "font-semibold text-destructive" : ""
                          }
                        >
                          {r.value}
                        </span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between border-t pt-1 text-muted-foreground">
                      <span>• {t("systemBranchesPage.blockerDepartments")}</span>
                      <span>{departmentsCount}</span>
                    </li>
                  </ul>
                  <div className="text-xs text-muted-foreground">
                    {t("systemBranchesPage.transferOrDeleteHint")}
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              m.mutate();
            }}
            disabled={m.isPending || loading || !canDelete}
          >
            {m.isPending && <Loader2 className="size-4 animate-spin" />}
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

