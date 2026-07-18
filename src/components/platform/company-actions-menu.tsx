import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
      toast.success(company.status === "active" ? "החברה הושבתה" : "החברה הופעלה");
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? "הפעולה נכשלה"),
  });

  const archiveMut = useMutation({
    mutationFn: () =>
      company.archivedAt
        ? companyService.unarchiveCompany(company.id)
        : companyService.archiveCompany(company.id),
    onSuccess: async () => {
      toast.success(company.archivedAt ? "החברה שוחזרה מהארכיון" : "החברה הועברה לארכיון");
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? "הפעולה נכשלה"),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="ניהול חברה">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>ניהול חברה</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            ערוך חברה
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => goToCompanyTab("branches")} className="gap-2">
            <GitBranch className="size-4" />
            נהל סניפים
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => goToCompanyTab("managers")} className="gap-2">
            <UserCog className="size-4" />
            מנהלי החברה
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => goToCompanyTab("settings")} className="gap-2">
            <SettingsIcon className="size-4" />
            הגדרות החברה
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toggleStatusMut.mutate()} className="gap-2">
            {company.status === "active" ? (
              <>
                <PowerOff className="size-4" />
                השבת חברה
              </>
            ) : (
              <>
                <Power className="size-4" />
                הפעל חברה
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => archiveMut.mutate()} className="gap-2">
            {company.archivedAt ? (
              <>
                <ArchiveRestore className="size-4" />
                שחזור מהארכיון
              </>
            ) : (
              <>
                <Archive className="size-4" />
                ארכיון
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDeleteOpen(true)}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4" />
            מחק חברה
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
