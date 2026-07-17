import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Archive, Building2, Loader2, Plus, ShieldAlert, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Company } from "@/modules/companies";
import { useCompanyContext } from "@/platform";
import { CompanySwitcher } from "@/components/platform/company-switcher";
import { CompanyActionsMenu } from "@/components/platform/company-actions-menu";
import { CompanyCreateDialog } from "@/components/platform/company-dialogs";

export const Route = createFileRoute("/_authenticated/platform/companies")({
  component: CompaniesPage,
});

const STATUS_LABELS: Record<Company["status"], string> = {
  active: "פעילה",
  inactive: "לא פעילה",
  suspended: "מושהית",
};

function StatusBadge({ company }: { company: Company }) {
  if (company.status === "active") {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
        <Star className="size-3" />
        פעילה
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-400"
    >
      <ShieldAlert className="size-3" />
      {STATUS_LABELS[company.status]}
    </Badge>
  );
}

function CompaniesPage() {
  const { companies, activeCompanyId, setActiveCompanyId, isLoading } = useCompanyContext();
  const [openCreate, setOpenCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const visibleCompanies = useMemo(
    () => companies.filter((c) => showArchived || !c.archivedAt),
    [companies, showArchived],
  );
  const archivedCount = useMemo(() => companies.filter((c) => c.archivedAt).length, [companies]);

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

      {archivedCount > 0 && (
        <div className="flex items-center gap-2 justify-end">
          <Label
            htmlFor="show-archived-companies"
            className="text-sm text-muted-foreground gap-2 flex items-center"
          >
            <Archive className="size-3.5" />
            הצג חברות בארכיון ({archivedCount})
          </Label>
          <Switch
            id="show-archived-companies"
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
        </div>
      )}

      <Card className="card-elevated overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : visibleCompanies.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            {companies.length === 0
              ? "אין עדיין חברות בפלטפורמה. ניתן ליצור חברה חדשה מהכפתור מעלה."
              : "אין חברות להצגה עם הסינון הנוכחי."}
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
                {visibleCompanies.map((company) => (
                  <tr
                    key={company.id}
                    className={`border-t hover:bg-accent/30 ${company.archivedAt ? "opacity-60" : ""}`}
                  >
                    <td className="p-3">
                      <Link
                        to="/platform/companies/$companyId"
                        params={{ companyId: company.id }}
                        search={{ tab: "dashboard" }}
                        className="flex items-center gap-2 min-w-0 hover:underline font-medium"
                      >
                        {company.logoUrl ? (
                          <img
                            src={company.logoUrl}
                            alt={company.name}
                            className="size-4 rounded object-contain shrink-0"
                          />
                        ) : (
                          <Building2 className="size-4 text-muted-foreground shrink-0" />
                        )}
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        {company.id === activeCompanyId && (
                          <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10">
                            <Star className="size-3" />
                            פעילה בפלטפורמה
                          </Badge>
                        )}
                        <StatusBadge company={company} />
                        {company.archivedAt && (
                          <Badge variant="secondary" className="gap-1">
                            <Archive className="size-3" />
                            בארכיון
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1 justify-end">
                        {company.id !== activeCompanyId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title="הפוך לפעילה"
                            onClick={() => setActiveCompanyId(company.id)}
                          >
                            <Star className="size-4" />
                          </Button>
                        )}
                        <CompanyActionsMenu company={company} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openCreate && <CompanyCreateDialog open={openCreate} onOpenChange={setOpenCreate} />}
    </div>
  );
}
