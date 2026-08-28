import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, UserCog, Search, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/lib/use-auth";
import { listBranchesWithStats, listEmployeesForManagerPicker, assignBranchManager } from "@/lib/branches.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BranchRow {
  id: string;
  name: string;
  code: string;
  manager_id: string | null;
  manager_name: string | null;
  employees_count: number;
  departments_count: number;
  active_schedules_count: number;
}

interface ManagerOption {
  id: string;
  full_name: string;
  is_active: boolean;
}

export const Route = createFileRoute("/_authenticated/system/branch-managers")({
  component: BranchManagersPage,
});

function BranchManagersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: profile } = useAuth();
  const isSystemAdmin = profile?.roles?.includes("system_admin");

  const listBranches = useServerFn(listBranchesWithStats);
  const listManagers = useServerFn(listEmployeesForManagerPicker);
  const assign = useServerFn(assignBranchManager);

  const branchesQ = useQuery({
    enabled: !!isSystemAdmin,
    queryKey: ["system", "branch-managers", "branches"],
    queryFn: async () => listBranches({}),
  });

  const managersQ = useQuery({
    enabled: !!isSystemAdmin,
    queryKey: ["system", "branch-managers", "managers"],
    queryFn: async () => listManagers({}),
  });

  const [search, setSearch] = useState("");
  const [selectedManagers, setSelectedManagers] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!branchesQ.data) return;
    setSelectedManagers((prev) => {
      const next: Record<string, string | null> = { ...prev };
      for (const branch of branchesQ.data as BranchRow[]) {
        next[branch.id] = branch.manager_id ?? null;
      }
      return next;
    });
  }, [branchesQ.data]);

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (branchesQ.data ?? []) as BranchRow[];
    if (!q) return rows;
    return rows.filter((branch) => {
      const hay = `${branch.name} ${branch.code} ${branch.manager_name ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [branchesQ.data, search]);

  const assignMut = useMutation({
    mutationFn: async ({ branchId, managerId }: { branchId: string; managerId: string | null }) =>
      assign({ data: { branch_id: branchId, manager_id: managerId } }),
    onSuccess: () => {
      toast.success(t("systemBranchManagersPage.assignUpdated"));
      qc.invalidateQueries({ queryKey: ["system", "branches"] });
      qc.invalidateQueries({ queryKey: ["system", "branch-managers", "branches"] });
    },
    onError: (error: Error) => toast.error(error.message ?? t("systemBranchManagersPage.updateFailed")),
  });

  function handleManagerChange(branchId: string, managerId: string | null) {
    setSelectedManagers((prev) => ({ ...prev, [branchId]: managerId }));
    assignMut.mutate({ branchId, managerId });
  }

  if (!isSystemAdmin) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl" dir="rtl">
        <Card className="p-8 text-center space-y-3">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-destructive/10">
            <UserCog className="size-6 text-destructive" />
          </div>
          <h1 className="text-xl font-bold">{t("shiftSettingsPage.noPermissionTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("systemBranchManagersPage.noPermissionDesc")}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCog className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("systemBranchManagersPage.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("systemBranchManagersPage.subtitle")}</p>
          </div>
        </div>
      </div>

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("systemBranchManagersPage.searchPlaceholder")}
            className="pr-9"
          />
        </div>
      </Card>

      {branchesQ.isLoading || managersQ.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredBranches.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t("systemBranchManagersPage.noBranches")}</Card>
      ) : (
        <div className="grid gap-4">
          {filteredBranches.map((branch) => {
            const selectedValue = selectedManagers[branch.id] ?? branch.manager_id ?? "__none__";
            return (
              <Card key={branch.id} className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 text-muted-foreground" />
                      <h2 className="text-lg font-semibold">{branch.name}</h2>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span>{t("systemBranchManagersPage.codeLabel")} {branch.code}</span>
                      <span>{t("systemBranchManagersPage.employeesLabel")} {branch.employees_count}</span>
                      <span>{t("systemBranchManagersPage.departmentsLabel")} {branch.departments_count}</span>
                      <span>{t("systemBranchManagersPage.activeSchedulesLabel")} {branch.active_schedules_count}</span>
                    </div>
                  </div>

                  <div className="w-full lg:max-w-sm">
                    <label className="mb-2 block text-sm font-medium">{t("systemBranchManagersPage.branchManagerLabel")}</label>
                    <Select
                      value={selectedValue}
                      onValueChange={(value) => handleManagerChange(branch.id, value === "__none__" ? null : value)}
                      disabled={assignMut.isPending}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("systemBranchManagersPage.noBranchManagerPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("systemBranchManagersPage.noBranchManager")}</SelectItem>
                        {(managersQ.data as ManagerOption[] | undefined)?.map((manager) => (
                          <SelectItem key={manager.id} value={manager.id}>
                            {manager.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {branch.manager_name
                        ? t("systemBranchManagersPage.currentManager", { name: branch.manager_name })
                        : t("systemBranchManagersPage.noManagerAssigned")}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
