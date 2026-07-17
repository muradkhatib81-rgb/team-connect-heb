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
  MapPin,
  Pencil,
  Phone,
  Settings as SettingsIcon,
  Star,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UUID } from "@/core";
import { branchService, type BranchDashboardSnapshot } from "@/modules/branches";
import { useBranchContext, useCompanyContext } from "@/platform";
import { BranchEditDialog, BranchDeleteDialog } from "@/components/platform/branch-dialogs";

export const Route = createFileRoute("/_authenticated/platform/branches/$branchId")({
  component: BranchDetailsPage,
  notFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">הסניף לא נמצא</div>,
});

const ADDRESS_KEY = "address";
const PHONE_KEY = "phone";

function BranchDetailsPage() {
  const { branchId } = Route.useParams();
  const navigate = useNavigate();
  const { companies, setActiveCompanyId } = useCompanyContext();
  const { activeBranchId, setActiveBranchId } = useBranchContext();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const branchQuery = useQuery({
    queryKey: ["platform-branch", branchId],
    queryFn: () => branchService.getBranch(branchId as UUID),
  });
  const branch = branchQuery.data ?? null;

  const dashboardQuery = useQuery({
    queryKey: ["branch-dashboard", branchId],
    queryFn: () => branchService.getBranchDashboard(branch as NonNullable<typeof branch>),
    enabled: !!branch,
  });

  if (branchQuery.isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!branch) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-2">
          <Link to="/platform/branches">
            <ArrowRight className="size-4" />
            חזרה לרשימת הסניפים
          </Link>
        </Button>
        <Card className="p-8 text-sm text-muted-foreground text-center">הסניף לא נמצא</Card>
      </div>
    );
  }

  const company = companies.find((c) => c.id === branch.companyId) ?? null;
  const isActive = branch.id === activeBranchId;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-2">
        <Link to="/platform/branches">
          <ArrowRight className="size-4" />
          חזרה לרשימת הסניפים
        </Link>
      </Button>

      <Card className="card-elevated p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="size-14 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <GitBranch className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold truncate">{branch.name}</h1>
              {isActive && (
                <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <Star className="size-3" />
                  סניף פעיל
                </Badge>
              )}
            </div>
            {company && (
              <Link
                to="/platform/companies/$companyId"
                params={{ companyId: company.id }}
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                <Building2 className="size-3.5" />
                {company.name}
              </Link>
            )}
            <p className="text-sm text-muted-foreground mt-1 font-mono" dir="ltr">
              {branch.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveCompanyId(branch.companyId);
                  setActiveBranchId(branch.id);
                }}
                className="gap-2"
              >
                <Star className="size-4" />
                הפוך לפעיל
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
          <TabsTrigger value="settings" className="gap-2">
            <SettingsIcon className="size-4" />
            הגדרות
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <BranchDashboardTab
            snapshot={dashboardQuery.data}
            isLoading={dashboardQuery.isLoading}
            companyName={company?.name}
          />
        </TabsContent>

        <TabsContent value="statistics">
          <BranchStatisticsTab
            snapshot={dashboardQuery.data}
            isLoading={dashboardQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="settings">
          <BranchSettingsTab branchId={branch.id} />
        </TabsContent>
      </Tabs>

      {editOpen && <BranchEditDialog open={editOpen} onOpenChange={setEditOpen} branch={branch} />}
      {deleteOpen && (
        <BranchDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          branch={branch}
          onDeleted={() => navigate({ to: "/platform/branches" })}
        />
      )}
    </div>
  );
}

function BranchDashboardTab({
  snapshot,
  isLoading,
  companyName,
}: {
  snapshot?: BranchDashboardSnapshot;
  isLoading: boolean;
  companyName?: string;
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
        icon={GitBranch}
        label="סניפים בחברה"
        value={snapshot.statistics.totalBranchesInCompany}
      />
      <StatCard icon={Calendar} label="גיל הסניף (ימים)" value={snapshot.statistics.ageInDays} />
      <StatCard icon={Building2} label="חברה" value={companyName ?? "—"} />
    </div>
  );
}

function BranchStatisticsTab({
  snapshot,
  isLoading,
}: {
  snapshot?: BranchDashboardSnapshot;
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
      <Row label="סניפים בחברה (סה״כ)" value={String(snapshot.statistics.totalBranchesInCompany)} />
      <Row label="נוצר בתאריך" value={snapshot.statistics.createdAt.toLocaleString("he-IL")} />
      <Row label="עודכן לאחרונה" value={snapshot.statistics.updatedAt.toLocaleString("he-IL")} />
      <Row label="גיל הסניף" value={`${snapshot.statistics.ageInDays} ימים`} />
    </Card>
  );
}

function BranchSettingsTab({ branchId }: { branchId: UUID }) {
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAddress(branchService.getBranchSetting<string>(branchId, ADDRESS_KEY) ?? "");
    setPhone(branchService.getBranchSetting<string>(branchId, PHONE_KEY) ?? "");
  }, [branchId]);

  const handleSave = () => {
    setSaving(true);
    try {
      branchService.setBranchSetting(branchId, ADDRESS_KEY, address.trim());
      branchService.setBranchSetting(branchId, PHONE_KEY, phone.trim());
      toast.success("הגדרות הסניף נשמרו");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="card-elevated p-6 space-y-5">
      <div className="space-y-2">
        <Label htmlFor="branch-address" className="flex items-center gap-1.5">
          <MapPin className="size-3.5" />
          כתובת
        </Label>
        <Input
          id="branch-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={200}
          placeholder="רחוב, מספר, עיר"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="branch-phone" className="flex items-center gap-1.5">
          <Phone className="size-3.5" />
          טלפון
        </Label>
        <Input
          id="branch-phone"
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={30}
          placeholder="03-1234567"
        />
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
  value: number | string;
  hint?: string;
}) {
  return (
    <Card className="card-elevated p-5 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums truncate">{value}</p>
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
