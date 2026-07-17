import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  GitBranch,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Star,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UUID } from "@/core";
import { companyService, type CompanyDashboardSnapshot } from "@/modules/companies";
import { branchService, type Branch } from "@/modules/branches";
import { useCompanyContext, branchesQueryKey } from "@/platform";
import { CompanyEditDialog, CompanyDeleteDialog } from "@/components/platform/company-dialogs";
import {
  BranchCreateDialog,
  BranchEditDialog,
  BranchDeleteDialog,
} from "@/components/platform/branch-dialogs";

export const Route = createFileRoute("/_authenticated/platform/companies/$companyId")({
  component: CompanyDetailsPage,
  notFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">החברה לא נמצאה</div>,
});

const CONTACT_EMAIL_KEY = "contactEmail";
const BILLING_ENABLED_KEY = "billingEnabled";

function CompanyDetailsPage() {
  const { companyId } = Route.useParams();
  const navigate = useNavigate();
  const { companies, activeCompanyId, setActiveCompanyId, isLoading } = useCompanyContext();
  const company = companies.find((c) => c.id === companyId) ?? null;

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: ["company-dashboard", companyId],
    queryFn: () => companyService.getCompanyDashboard(company as NonNullable<typeof company>),
    enabled: !!company,
  });

  const branchesQuery = useQuery({
    queryKey: branchesQueryKey(company?.id ?? null),
    queryFn: () => branchService.listBranches(company?.id as UUID),
    enabled: !!company,
  });

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-2">
          <Link to="/platform/companies">
            <ArrowRight className="size-4" />
            חזרה לרשימת החברות
          </Link>
        </Button>
        <Card className="p-8 text-sm text-muted-foreground text-center">החברה לא נמצאה</Card>
      </div>
    );
  }

  const isActive = company.id === activeCompanyId;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-2">
        <Link to="/platform/companies">
          <ArrowRight className="size-4" />
          חזרה לרשימת החברות
        </Link>
      </Button>

      <Card className="card-elevated p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="size-14 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Building2 className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold truncate">{company.name}</h1>
              {isActive && (
                <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <Star className="size-3" />
                  חברה פעילה
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 font-mono" dir="ltr">
              {company.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveCompanyId(company.id)}
                className="gap-2"
              >
                <Star className="size-4" />
                הפוך לפעילה
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
              <Pencil className="size-4" />
              עריכה
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
              מחיקה
            </Button>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard" className="gap-2">
            <LayoutDashboard className="size-4" />
            סקירה כללית
          </TabsTrigger>
          <TabsTrigger value="statistics" className="gap-2">
            <BarChart3 className="size-4" />
            סטטיסטיקות
          </TabsTrigger>
          <TabsTrigger value="branches" className="gap-2">
            <GitBranch className="size-4" />
            סניפים
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <SettingsIcon className="size-4" />
            הגדרות
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <CompanyDashboardTab
            snapshot={dashboardQuery.data}
            isLoading={dashboardQuery.isLoading}
            branchesCount={branchesQuery.data?.length ?? 0}
          />
        </TabsContent>

        <TabsContent value="statistics">
          <CompanyStatisticsTab
            snapshot={dashboardQuery.data}
            isLoading={dashboardQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="branches">
          <CompanyBranchesTab
            companyId={company.id}
            branches={branchesQuery.data ?? []}
            isLoading={branchesQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="settings">
          <CompanySettingsTab companyId={company.id} />
        </TabsContent>
      </Tabs>

      {editOpen && (
        <CompanyEditDialog open={editOpen} onOpenChange={setEditOpen} company={company} />
      )}
      {deleteOpen && (
        <CompanyDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          company={company}
          onDeleted={() => navigate({ to: "/platform/companies" })}
        />
      )}
    </div>
  );
}

function CompanyDashboardTab({
  snapshot,
  isLoading,
  branchesCount,
}: {
  snapshot?: CompanyDashboardSnapshot;
  isLoading: boolean;
  branchesCount: number;
}) {
  if (isLoading || !snapshot) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard
        icon={Building2}
        label="חברות בפלטפורמה"
        value={snapshot.statistics.totalCompaniesOnPlatform}
      />
      <StatCard icon={Calendar} label="גיל החברה (ימים)" value={snapshot.statistics.ageInDays} />
      <StatCard icon={GitBranch} label="סניפים משויכים" value={branchesCount} />
    </div>
  );
}

function CompanyStatisticsTab({
  snapshot,
  isLoading,
}: {
  snapshot?: CompanyDashboardSnapshot;
  isLoading: boolean;
}) {
  if (isLoading || !snapshot) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="card-elevated p-5 space-y-3">
      <Row
        label="חברות בפלטפורמה (סה״כ)"
        value={String(snapshot.statistics.totalCompaniesOnPlatform)}
      />
      <Row label="נוצרה בתאריך" value={snapshot.statistics.createdAt.toLocaleString("he-IL")} />
      <Row label="עודכנה לאחרונה" value={snapshot.statistics.updatedAt.toLocaleString("he-IL")} />
      <Row label="גיל החברה" value={`${snapshot.statistics.ageInDays} ימים`} />
    </Card>
  );
}

function CompanyBranchesTab({
  companyId,
  branches,
  isLoading,
}: {
  companyId: UUID;
  branches: Branch[];
  isLoading: boolean;
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [deleteBranch, setDeleteBranch] = useState<Branch | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpenCreate(true)} size="sm" className="gap-2">
          <Plus className="size-4" />
          סניף חדש
        </Button>
      </div>

      <Card className="card-elevated overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : branches.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            לחברה זו אין עדיין סניפים. ניתן ליצור סניף חדש מהכפתור מעלה.
          </div>
        ) : (
          <ul className="divide-y">
            {branches.map((branch) => (
              <li key={branch.id} className="flex items-center gap-3 p-3 hover:bg-accent/30">
                <GitBranch className="size-4 text-muted-foreground shrink-0" />
                <Link
                  to="/platform/branches/$branchId"
                  params={{ branchId: branch.id }}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {branch.name}
                </Link>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {branch.createdAt.toLocaleDateString("he-IL")}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 shrink-0">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditBranch(branch)} className="gap-2">
                      <Pencil className="size-4" />
                      עריכה
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDeleteBranch(branch)}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      מחיקה
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {openCreate && (
        <BranchCreateDialog open={openCreate} onOpenChange={setOpenCreate} companyId={companyId} />
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

function CompanySettingsTab({ companyId }: { companyId: UUID }) {
  const [contactEmail, setContactEmail] = useState("");
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContactEmail(companyService.getCompanySetting<string>(companyId, CONTACT_EMAIL_KEY) ?? "");
    setBillingEnabled(
      companyService.getCompanySetting<boolean>(companyId, BILLING_ENABLED_KEY) ?? false,
    );
  }, [companyId]);

  const handleSave = () => {
    setSaving(true);
    try {
      companyService.setCompanySetting(companyId, CONTACT_EMAIL_KEY, contactEmail.trim());
      companyService.setCompanySetting(companyId, BILLING_ENABLED_KEY, billingEnabled);
      toast.success("הגדרות החברה נשמרו");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="card-elevated p-6 space-y-5">
      <div className="space-y-2">
        <Label htmlFor="company-contact-email">אימייל ליצירת קשר</Label>
        <Input
          id="company-contact-email"
          type="email"
          dir="ltr"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          maxLength={160}
          placeholder="contact@company.com"
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">חיוב פעיל</p>
          <p className="text-xs text-muted-foreground">האם החברה כלולה במעגל החיוב של הפלטפורמה</p>
        </div>
        <Switch checked={billingEnabled} onCheckedChange={setBillingEnabled} />
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
          {saving && <Loader2 className="size-4 animate-spin" />}
          שמירת הגדרות
        </Button>
      </div>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card className="card-elevated p-5 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm truncate">{value}</span>
    </div>
  );
}
