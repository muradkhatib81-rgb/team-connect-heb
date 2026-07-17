import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Building2,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Branch } from "@/modules/branches";
import { useBranchContext, useCompanyContext } from "@/platform";
import { CompanySwitcher } from "@/components/platform/company-switcher";
import { PlatformBranchSwitcher } from "@/components/platform/branch-switcher";
import {
  BranchCreateDialog,
  BranchEditDialog,
  BranchDeleteDialog,
} from "@/components/platform/branch-dialogs";

export const Route = createFileRoute("/_authenticated/platform/branches")({
  component: BranchesPage,
});

function BranchesPage() {
  const {
    activeCompany,
    activeCompanyId,
    companies,
    isLoading: companiesLoading,
  } = useCompanyContext();
  const {
    branches,
    activeBranchId,
    setActiveBranchId,
    isLoading: branchesLoading,
  } = useBranchContext();
  const [openCreate, setOpenCreate] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [deleteBranch, setDeleteBranch] = useState<Branch | null>(null);

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <GitBranch className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">סניפים</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCompany
              ? `ניהול הסניפים של ${activeCompany.name}`
              : "ניהול הסניפים של החברות בפלטפורמה"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CompanySwitcher />
        <PlatformBranchSwitcher />
        <Button onClick={() => setOpenCreate(true)} disabled={!activeCompanyId} className="gap-2">
          <Plus className="size-4" />
          שיוך סניף קיים
        </Button>
      </div>
    </header>
  );

  if (!companiesLoading && companies.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="p-8 text-sm text-muted-foreground text-center space-y-3">
          <p>יש ליצור חברה בפלטפורמה לפני ניהול סניפים.</p>
          <Button asChild size="sm" className="gap-2">
            <Link to="/platform/companies">
              <Building2 className="size-4" />
              ניהול חברות
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <Card className="card-elevated overflow-hidden">
        {companiesLoading || branchesLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !activeCompanyId ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            יש לבחור חברה פעילה (מהבורר מעלה) כדי לראות ולנהל את הסניפים שלה.
          </div>
        ) : branches.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין עדיין סניפים משויכים לחברה הפעילה. ניתן לשייך סניף קיים מהכפתור מעלה.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-right p-3 font-medium">שם הסניף</th>
                  <th className="text-right p-3 font-medium hidden md:table-cell">מזהה</th>
                  <th className="text-right p-3 font-medium hidden lg:table-cell">נוצר</th>
                  <th className="text-right p-3 font-medium">סטטוס</th>
                  <th className="p-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id} className="border-t hover:bg-accent/30">
                    <td className="p-3">
                      <Link
                        to="/platform/branches/$branchId"
                        params={{ branchId: branch.id }}
                        className="flex items-center gap-2 min-w-0 hover:underline font-medium"
                      >
                        <GitBranch className="size-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{branch.name}</span>
                      </Link>
                    </td>
                    <td
                      className="p-3 hidden md:table-cell text-muted-foreground font-mono text-xs"
                      dir="ltr"
                    >
                      {branch.id.slice(0, 8)}…
                    </td>
                    <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground tabular-nums">
                      {branch.createdAt.toLocaleDateString("he-IL")}
                    </td>
                    <td className="p-3">
                      {branch.id === activeBranchId ? (
                        <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
                          <Star className="size-3" />
                          פעיל
                        </Badge>
                      ) : (
                        <Badge variant="outline">לא פעיל</Badge>
                      )}
                    </td>
                    <td className="p-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {branch.id !== activeBranchId && (
                            <DropdownMenuItem
                              onClick={() => setActiveBranchId(branch)}
                              className="gap-2"
                            >
                              <Star className="size-4" />
                              הפוך לפעיל
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setEditBranch(branch)} className="gap-2">
                            <Pencil className="size-4" />
                            פרטים / סנכרון
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteBranch(branch)}
                            className="gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="size-4" />
                            הסרת שיוך
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openCreate && activeCompanyId && (
        <BranchCreateDialog
          open={openCreate}
          onOpenChange={setOpenCreate}
          companyId={activeCompanyId}
          onCreated={(branch) => setActiveBranchId(branch)}
        />
      )}
      {editBranch && (
        <BranchEditDialog
          open={!!editBranch}
          onOpenChange={(v) => !v && setEditBranch(null)}
          branch={editBranch}
        />
      )}
      {deleteBranch && (
        <BranchDeleteDialog
          open={!!deleteBranch}
          onOpenChange={(v) => !v && setDeleteBranch(null)}
          branch={deleteBranch}
        />
      )}
    </div>
  );
}
