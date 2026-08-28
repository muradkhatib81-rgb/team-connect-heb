import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
  Settings as SettingsIcon,
  Trash2,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { companyService, type Company } from "@/modules/companies";
import { companiesQueryKey, useCompanyContext, usePlatformContext } from "@/platform";
import { CompanyEditDialog, CompanyDeleteDialog } from "./company-dialogs";

type CompanyDetailsTab = "branches" | "managers" | "settings";

/**
 * Company Actions Menu (⋮ / "ניהול") — the single, reusable entry point for
 * every Company-level action (Part 1). Used from both the Companies list
 * and the Company Details page so the two never drift into duplicated
 * dropdowns.
 */
export function CompanyActionsMenu({
  company,
  onDeleted,
}: {
  company: Company;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const { platform } = usePlatformContext();
  const { setActiveCompanyId } = useCompanyContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: companiesQueryKey(platform.id) });

  const goToCompanyTab = (tab: CompanyDetailsTab) => {
    setActiveCompanyId(company.id);
    void navigate({
      to: "/platform/companies/$companyId",
      params: { companyId: company.id },
      search: { tab },
    });
  };

  const toggleStatusMut = useMutation({
    mutationFn: () =>
      companyService.setCompanyStatus(
        company.id,
        company.status === "active" ? "inactive" : "active",
      ),
    onSuccess: async () => {
      toast.success(
        company.status === "active"
          ? t("platformCompanyActions.toasts.deactivated")
          : t("platformCompanyActions.toasts.activated"),
      );
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformCompanyActions.toasts.actionFailed")),
  });

  const archiveMut = useMutation({
    mutationFn: () =>
      company.archivedAt
        ? companyService.unarchiveCompany(company.id)
        : companyService.archiveCompany(company.id),
    onSuccess: async () => {
      toast.success(
        company.archivedAt
          ? t("platformCompanyActions.toasts.restored")
          : t("platformCompanyActions.toasts.archived"),
      );
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformCompanyActions.toasts.actionFailed")),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("platformCompanyActions.ariaLabel")}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t("platformCompanyActions.menuLabel")}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            {t("platformCompanyActions.editCompany")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => goToCompanyTab("branches")} className="gap-2">
            <GitBranch className="size-4" />
            {t("platformCompanyActions.manageBranches")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => goToCompanyTab("managers")} className="gap-2">
            <UserCog className="size-4" />
            {t("platformCompanyActions.companyManagers")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => goToCompanyTab("settings")} className="gap-2">
            <SettingsIcon className="size-4" />
            {t("platformCompanyActions.companySettings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toggleStatusMut.mutate()} className="gap-2">
            {company.status === "active" ? (
              <>
                <PowerOff className="size-4" />
                {t("platformCompanyActions.deactivateCompany")}
              </>
            ) : (
              <>
                <Power className="size-4" />
                {t("platformCompanyActions.activateCompany")}
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => archiveMut.mutate()} className="gap-2">
            {company.archivedAt ? (
              <>
                <ArchiveRestore className="size-4" />
                {t("platformCompanyActions.restoreFromArchive")}
              </>
            ) : (
              <>
                <Archive className="size-4" />
                {t("platformCompanyActions.archive")}
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDeleteOpen(true)}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4" />
            {t("platformCompanyActions.deleteCompany")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editOpen && (
        <CompanyEditDialog open={editOpen} onOpenChange={setEditOpen} company={company} />
      )}
      {deleteOpen && (
        <CompanyDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          company={company}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
