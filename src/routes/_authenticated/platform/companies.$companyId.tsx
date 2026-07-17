import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  FileText,
  GitBranch,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  ShieldAlert,
  Star,
  Trash2,
  UserCog,
  Users,
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
import {
  companyService,
  type Company,
  type CompanyDashboardSnapshot,
  type CompanyManagerEntry,
} from "@/modules/companies";
import { branchService, type Branch } from "@/modules/branches";
import { useCompanyContext, branchesQueryKey } from "@/platform";
import { CompanyActionsMenu } from "@/components/platform/company-actions-menu";
import {
  BranchCreateDialog,
  BranchEditDialog,
  BranchDeleteDialog,
} from "@/components/platform/branch-dialogs";

const VALID_TABS = [
  "dashboard",
  "statistics",
  "branches",
  "managers",
  "users",
  "reports",
  "settings",
] as const;
type CompanyDetailsTab = (typeof VALID_TABS)[number];

export const Route = createFileRoute("/_authenticated/platform/companies/$companyId")({
  component: CompanyDetailsPage,
  notFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">החברה לא נמצאה</div>,
  validateSearch: (search: Record<string, unknown>): { tab: CompanyDetailsTab } => {
    const raw = typeof search.tab === "string" ? search.tab : "dashboard";
    return {
      tab: (VALID_TABS as readonly string[]).includes(raw)
        ? (raw as CompanyDetailsTab)
        : "dashboard",
    };
  },
});

const CONTACT_EMAIL_KEY = "contactEmail";
const BILLING_ENABLED_KEY = "billingEnabled";

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

function CompanyDetailsPage() {
  const { companyId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { companies, activeCompanyId, setActiveCompanyId, isLoading } = useCompanyContext();
  const company = companies.find((c) => c.id === companyId) ?? null;

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
          <div className="size-14 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center overflow-hidden">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={company.name} className="size-full object-contain" />
            ) : (
              <Building2 className="size-7" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold truncate">{company.name}</h1>
              {isActive && (
                <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10">
                  <Star className="size-3" />
                  חברה פעילה בפלטפורמה
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
            {company.legalName && (
              <p className="text-sm text-muted-foreground mt-1">{company.legalName}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1 font-mono" dir="ltr">
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
            <CompanyActionsMenu
              company={company}
              onDeleted={() => navigate({ to: "/platform/companies" })}
            />
          </div>
        </div>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ search: { tab: v as CompanyDetailsTab } })}
        className="space-y-4"
      >
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
          <TabsTrigger value="managers" className="gap-2">
            <UserCog className="size-4" />
            מנהלים
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="size-4" />
            משתמשים
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="size-4" />
            דוחות
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

        <TabsContent value="managers">
          <CompanyManagersTab companyId={company.id} />
        </TabsContent>

        <TabsContent value="users">
          <CompanyUsersTab branchesCount={branchesQuery.data?.length ?? 0} />
        </TabsContent>

        <TabsContent value="reports">
          <CompanyReportsTab
            snapshot={dashboardQuery.data}
            branches={branchesQuery.data ?? []}
            isLoading={dashboardQuery.isLoading || branchesQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="settings">
          <CompanySettingsTab companyId={company.id} />
        </TabsContent>
      </Tabs>
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
          שיוך סניף קיים
        </Button>
      </div>

      <Card className="card-elevated overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : branches.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            לחברה זו אין עדיין סניפים משויכים. ניתן לשייך סניף קיים מהכפתור מעלה.
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

const COMPANY_MANAGERS_QUERY_KEY = (companyId: UUID) => ["company-managers", companyId] as const;

function CompanyManagersTab({ companyId }: { companyId: UUID }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const managersQuery = useQuery({
    queryKey: COMPANY_MANAGERS_QUERY_KEY(companyId),
    queryFn: () => companyService.listCompanyManagers(companyId),
  });

  const addMut = useMutation({
    mutationFn: async () => companyService.addCompanyManager(companyId, name, email),
    onSuccess: () => {
      toast.success("המנהל נוסף לחברה");
      setName("");
      setEmail("");
      qc.invalidateQueries({ queryKey: COMPANY_MANAGERS_QUERY_KEY(companyId) });
    },
    onError: (error: Error) => toast.error(error.message ?? "ההוספה נכשלה"),
  });

  const removeMut = useMutation({
    mutationFn: async (managerId: UUID) =>
      companyService.removeCompanyManager(companyId, managerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMPANY_MANAGERS_QUERY_KEY(companyId) }),
  });

  const managers = managersQuery.data ?? [];

  return (
    <div className="space-y-4">
      <Card className="card-elevated p-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addMut.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="manager-name" className="text-xs">
              שם המנהל
            </Label>
            <Input
              id="manager-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="שם מלא"
              className="w-48"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manager-email" className="text-xs">
              אימייל (אופציונלי)
            </Label>
            <Input
              id="manager-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={160}
              placeholder="manager@company.com"
              className="w-56"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="gap-2"
            disabled={addMut.isPending || !name.trim()}
          >
            <Plus className="size-4" />
            הוספת מנהל
          </Button>
        </form>
      </Card>

      <Card className="card-elevated overflow-hidden">
        {managersQuery.isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : managers.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            לחברה זו אין עדיין מנהלים רשומים. ניתן להוסיף מנהל מהטופס מעלה.
          </div>
        ) : (
          <ul className="divide-y">
            {managers.map((manager: CompanyManagerEntry) => (
              <li key={manager.id} className="flex items-center gap-3 p-3">
                <UserCog className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{manager.name}</p>
                  {manager.email && (
                    <p className="text-xs text-muted-foreground truncate" dir="ltr">
                      {manager.email}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => removeMut.mutate(manager.id)}
                  disabled={removeMut.isPending}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function CompanyUsersTab({ branchesCount }: { branchesCount: number }) {
  return (
    <Card className="card-elevated p-8 text-center space-y-2">
      <Users className="size-8 mx-auto text-muted-foreground" />
      <p className="text-sm font-medium">אין עדיין ספריית משתמשים מחוברת לחברה זו</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        המשתמשים בפועל (עובדים) מנוהלים כיום בהיקף הסניף הבודד, ולא בהיקף החברה. לחברה זו יש{" "}
        {branchesCount} סניפים — ניתן לנהל את המשתמשים מתוך כל סניף בנפרד.
      </p>
    </Card>
  );
}

function CompanyReportsTab({
  snapshot,
  branches,
  isLoading,
}: {
  snapshot?: CompanyDashboardSnapshot;
  branches: Branch[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  const sortedByAge = [...branches].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const oldestBranch = sortedByAge[0];
  const newestBranch = sortedByAge[sortedByAge.length - 1];
  const avgBranchAgeDays =
    branches.length > 0
      ? Math.round(
          branches.reduce(
            (sum, b) => sum + (Date.now() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24),
            0,
          ) / branches.length,
        )
      : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={GitBranch} label="סניפים בחברה" value={branches.length} />
        <StatCard icon={Calendar} label="גיל ממוצע לסניף (ימים)" value={avgBranchAgeDays} />
        <StatCard
          icon={Calendar}
          label="גיל החברה (ימים)"
          value={snapshot?.statistics.ageInDays ?? 0}
        />
      </div>
      <Card className="card-elevated p-5 space-y-3">
        <Row label="הסניף הראשון שנוצר" value={oldestBranch?.name ?? "—"} />
        <Row label="הסניף האחרון שנוצר" value={newestBranch?.name ?? "—"} />
      </Card>
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
