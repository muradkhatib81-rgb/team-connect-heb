import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompanyContext } from "@/platform";
import { branchService } from "@/modules/branches";
import { usePlatformFeatureFlagState } from "@/lib/use-platform-feature-flags";
import {
  createPlatformAnnouncement,
  deletePlatformAnnouncement,
  listPlatformAnnouncementsAdmin,
} from "@/lib/platform-announcements.functions";

export const Route = createFileRoute("/_authenticated/platform/announcements")({
  component: PlatformAnnouncementsPage,
});

function PlatformAnnouncementsPage() {
  const { t } = useTranslation();
  const flags = usePlatformFeatureFlagState();
  const qc = useQueryClient();
  const { companies } = useCompanyContext();
  const listFn = useServerFn(listPlatformAnnouncementsAdmin);
  const createFn = useServerFn(createPlatformAnnouncement);
  const deleteFn = useServerFn(deletePlatformAnnouncement);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"all" | "company" | "branch">("all");
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");

  const branchesQ = useQuery({
    queryKey: ["platform-all-branches"],
    queryFn: () => branchService.listAllBranches(),
    enabled: flags.announcements,
  });

  const listQ = useQuery({
    queryKey: ["platform-announcements-admin"],
    queryFn: () => listFn(),
    enabled: flags.announcements,
  });

  const branches = useMemo(
    () => (branchesQ.data ?? []).filter((b) => !companyId || b.companyId === companyId),
    [branchesQ.data, companyId],
  );

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          title,
          body,
          scope,
          companyId: scope === "all" ? null : companyId || null,
          branchId: scope === "branch" ? branchId || null : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["platform-announcements-visible"] });
      toast.success(t("platformAnnouncements.created"));
      setOpen(false);
      setTitle("");
      setBody("");
      setScope("all");
      setCompanyId("");
      setBranchId("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["platform-announcements-visible"] });
      toast.success(t("platformAnnouncements.deleted"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function scopeLabel(row: { company_id: string | null; branch_id: string | null }) {
    if (row.branch_id) {
      const branch = (branchesQ.data ?? []).find(
        (b) => b.sourceBranchId === row.branch_id || b.id === row.branch_id,
      );
      const company = companies.find((c) => c.id === row.company_id);
      return t("platformAnnouncements.scopeBranchValue", {
        company: company?.name ?? row.company_id,
        branch: branch?.name ?? row.branch_id,
      });
    }
    if (row.company_id) {
      const company = companies.find((c) => c.id === row.company_id);
      return t("platformAnnouncements.scopeCompanyValue", {
        company: company?.name ?? row.company_id,
      });
    }
    return t("platformAnnouncements.scopeAll");
  }

  if (!flags.isLoading && !flags.announcements) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <div className="size-12 rounded-xl bg-muted flex items-center justify-center">
          <Megaphone className="size-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">{t("platformAnnouncements.disabledTitle")}</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("platformAnnouncements.disabledDesc")}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/platform/feature-flags">{t("maintenancePage.openFeatureFlags")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Megaphone className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="break-words text-2xl sm:text-3xl font-bold">
              {t("platformAnnouncements.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("platformAnnouncements.subtitle")}
            </p>
          </div>
        </div>
        <Button className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {t("platformAnnouncements.new")}
        </Button>
      </header>

      <Card className="card-elevated overflow-hidden">
        {listQ.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            {t("platformAnnouncements.loading")}
          </div>
        ) : (listQ.data ?? []).length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            {t("platformAnnouncements.empty")}
          </div>
        ) : (
          <ul className="divide-y">
            {(listQ.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{row.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                    {row.body}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {scopeLabel(row)} · {new Date(row.created_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="self-end text-destructive sm:self-start"
                  onClick={() => deleteMut.mutate(row.id)}
                  disabled={deleteMut.isPending}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>{t("platformAnnouncements.new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>
              {t("platformAnnouncements.formTitle")}
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Label>
            <Label>
              {t("platformAnnouncements.formBody")}
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
            </Label>
            <Label>
              {t("platformAnnouncements.scope")}
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v as typeof scope);
                  if (v === "all") {
                    setCompanyId("");
                    setBranchId("");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("platformAnnouncements.scopeAll")}</SelectItem>
                  <SelectItem value="company">{t("platformAnnouncements.scopeCompany")}</SelectItem>
                  <SelectItem value="branch">{t("platformAnnouncements.scopeBranch")}</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            {scope !== "all" && (
              <Label>
                {t("platformAnnouncements.scopeCompany")}
                <Select
                  value={companyId}
                  onValueChange={(v) => {
                    setCompanyId(v);
                    setBranchId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("platformAnnouncements.selectCompany")} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}
            {scope === "branch" && (
              <Label>
                {t("platformAnnouncements.scopeBranch")}
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("platformAnnouncements.selectBranch")} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.sourceBranchId} value={b.sourceBranchId}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !title.trim() || !body.trim()}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
