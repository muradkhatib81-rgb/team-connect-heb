import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, Loader2, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Company } from "@/modules/companies";
import { useCompanyContext } from "@/platform";
import { CompanySwitcher } from "@/components/platform/company-switcher";
import {
  CompanyCreateDialog,
  CompanyEditDialog,
  CompanyDeleteDialog,
} from "@/components/platform/company-dialogs";

export const Route = createFileRoute("/_authenticated/platform/companies")({
  component: CompaniesPage,
});

function CompaniesPage() {
  const { companies, activeCompanyId, setActiveCompanyId, isLoading } = useCompanyContext();
  const [openCreate, setOpenCreate] = useState(false);
  const [editCompany, setEditCompany] = useState<Company | null>(null);
  const [deleteCompany, setDeleteCompany] = useState<Company | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Building2 className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">חברות</h1>
            <p className="text-sm text-muted-foreground mt-1">
              ניהול החברות (Tenants) הפועלות על גבי הפלטפורמה
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CompanySwitcher />
          <Button onClick={() => setOpenCreate(true)} className="gap-2">
            <Plus className="size-4" />
            חברה חדשה
          </Button>
        </div>
      </header>

      <Card className="card-elevated overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : companies.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין עדיין חברות בפלטפורמה. ניתן ליצור חברה חדשה מהכפתור מעלה.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-right p-3 font-medium">שם החברה</th>
                  <th className="text-right p-3 font-medium hidden md:table-cell">מזהה</th>
                  <th className="text-right p-3 font-medium hidden lg:table-cell">נוצרה</th>
                  <th className="text-right p-3 font-medium">סטטוס</th>
                  <th className="p-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id} className="border-t hover:bg-accent/30">
                    <td className="p-3">
                      <Link
                        to="/platform/companies/$companyId"
                        params={{ companyId: company.id }}
                        className="flex items-center gap-2 min-w-0 hover:underline font-medium"
                      >
                        <Building2 className="size-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{company.name}</span>
                      </Link>
                    </td>
                    <td
                      className="p-3 hidden md:table-cell text-muted-foreground font-mono text-xs"
                      dir="ltr"
                    >
                      {company.id.slice(0, 8)}…
                    </td>
                    <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground tabular-nums">
                      {company.createdAt.toLocaleDateString("he-IL")}
                    </td>
                    <td className="p-3">
                      {company.id === activeCompanyId ? (
                        <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
                          <Star className="size-3" />
                          פעילה
                        </Badge>
                      ) : (
                        <Badge variant="outline">לא פעילה</Badge>
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
                          {company.id !== activeCompanyId && (
                            <DropdownMenuItem
                              onClick={() => setActiveCompanyId(company.id)}
                              className="gap-2"
                            >
                              <Star className="size-4" />
                              הפוך לפעילה
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => setEditCompany(company)}
                            className="gap-2"
                          >
                            <Pencil className="size-4" />
                            עריכה
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteCompany(company)}
                            className="gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="size-4" />
                            מחיקה
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

      {openCreate && <CompanyCreateDialog open={openCreate} onOpenChange={setOpenCreate} />}
      {editCompany && (
        <CompanyEditDialog
          open={!!editCompany}
          onOpenChange={(v) => !v && setEditCompany(null)}
          company={editCompany}
        />
      )}
      {deleteCompany && (
        <CompanyDeleteDialog
          open={!!deleteCompany}
          onOpenChange={(v) => !v && setDeleteCompany(null)}
          company={deleteCompany}
        />
      )}
    </div>
  );
}
