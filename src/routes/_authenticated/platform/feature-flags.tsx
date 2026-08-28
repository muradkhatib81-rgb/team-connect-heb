import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, Eye, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/use-auth";
import { usePlatformContext } from "@/platform";
import type { UUID } from "@/core";
import type { FeatureFlag } from "@/core/config/types";

export const Route = createFileRoute("/_authenticated/platform/feature-flags")({
  component: PlatformFeatureFlagsPage,
});

const FLAGS_QUERY_KEY = ["platform-feature-flags"] as const;

const FLAG_SCOPES = ["platform", "company", "branch"] as const;
type FlagScope = (typeof FLAG_SCOPES)[number];

function scopeLabel(scope: string, t: (key: string) => string) {
  if (FLAG_SCOPES.includes(scope as FlagScope)) {
    return t(`platformFeatureFlags.scopes.${scope}`);
  }
  return scope;
}

function PlatformFeatureFlagsPage() {
  const { t } = useTranslation();
  const { runtime } = usePlatformContext();
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name");
  const [editing, setEditing] = useState<FeatureFlag | null>(null);
  const [details, setDetails] = useState<FeatureFlag | null>(null);
  const [deleting, setDeleting] = useState<FeatureFlag | null>(null);

  const flagsQuery = useQuery({
    queryKey: FLAGS_QUERY_KEY,
    queryFn: () => runtime.listFeatureFlags(),
  });

  const actionMut = useMutation({
    mutationFn: async ({ action, flag, enabled }: { action: string; flag: FeatureFlag; enabled?: boolean }) => {
      const previous = { ...flag };
      if (action === "toggle") runtime.setFeatureFlagEnabled(flag.key, !!enabled);
      if (action === "archive") runtime.archiveFeatureFlag(flag.key);
      if (action === "restore") runtime.restoreFeatureFlag(flag.key);
      if (action === "delete") runtime.deleteFeatureFlag(flag.key);
      runtime.recordFeatureFlagAudit(`feature-flag.${action}`, (profile?.id ?? "unknown") as UUID, flag.key, previous, action === "delete" ? null : { ...flag, enabled: enabled ?? flag.enabled });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
      toast.success(t("platformFeatureFlags.actionSuccess"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const flags = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (flagsQuery.data ?? [])
      .filter((flag) => scope === "all" || flag.scope === scope)
      .filter((flag) => status === "all" || (status === "archived" ? !!flag.archivedAt : status === "enabled" ? !flag.archivedAt && flag.enabled : !flag.archivedAt && !flag.enabled))
      .filter((flag) => !q || flag.displayName.toLowerCase().includes(q) || flag.key.toLowerCase().includes(q))
      .sort((a, b) => sort === "updated" ? b.updatedAt.getTime() - a.updatedAt.getTime() : sort === "scope" ? a.scope.localeCompare(b.scope) : sort === "status" ? Number(b.enabled) - Number(a.enabled) : a.displayName.localeCompare(b.displayName));
  }, [flagsQuery.data, scope, search, sort, status]);

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Flag className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("platformFeatureFlags.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("platformFeatureFlags.subtitle")}</p>
          </div>
        </div>
        <Button onClick={() => setEditing({} as FeatureFlag)} className="w-full shrink-0 gap-2 sm:w-auto">
          <Plus className="size-4" />
          {t("platformFeatureFlags.newFlag")}
        </Button>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("platformFeatureFlags.searchPlaceholder")}
        />
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("platformFeatureFlags.filters.allScopes")}</SelectItem>
            {FLAG_SCOPES.map((value) => (
              <SelectItem key={value} value={value}>
                {scopeLabel(value, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("platformFeatureFlags.filters.allStatuses")}</SelectItem>
            <SelectItem value="enabled">{t("platformFeatureFlags.filters.enabled")}</SelectItem>
            <SelectItem value="disabled">{t("platformFeatureFlags.filters.disabled")}</SelectItem>
            <SelectItem value="archived">{t("platformFeatureFlags.filters.archived")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{t("platformFeatureFlags.sort.name")}</SelectItem>
            <SelectItem value="scope">{t("platformFeatureFlags.sort.scope")}</SelectItem>
            <SelectItem value="status">{t("platformFeatureFlags.sort.status")}</SelectItem>
            <SelectItem value="updated">{t("platformFeatureFlags.sort.updated")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="card-elevated overflow-hidden">
        {flagsQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">{t("platformFeatureFlags.loading")}</div>
        ) : flags.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">{t("platformFeatureFlags.empty")}</div>
        ) : (
          <ul className="divide-y">
            {flags.map((flag) => (
              <li key={flag.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="min-w-0 w-full flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium break-words">{flag.displayName}</span>
                    <span className="font-mono text-xs sm:text-sm font-medium break-all" dir="ltr">
                      {flag.key}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {scopeLabel(flag.scope, t)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground break-words">
                    {flag.updatedAt.toLocaleString("he-IL")} · {flag.updatedBy ?? t("platformFeatureFlags.system")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 self-end sm:gap-2 sm:self-center">
                <Switch
                  checked={flag.enabled}
                  disabled={actionMut.isPending || !!flag.archivedAt}
                  onCheckedChange={(checked) =>
                    actionMut.mutate({ action: "toggle", flag, enabled: checked })
                  }
                />
                <Button variant="ghost" size="icon" onClick={() => setDetails(flag)}><Eye className="size-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setEditing(flag)}><Pencil className="size-4" /></Button>
                {flag.archivedAt ? <Button variant="ghost" size="icon" onClick={() => actionMut.mutate({ action: "restore", flag })}><ArchiveRestore className="size-4" /></Button> : <Button variant="ghost" size="icon" onClick={() => actionMut.mutate({ action: "archive", flag })}><Archive className="size-4" /></Button>}
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleting(flag)}><Trash2 className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <FlagDialog flag={editing} onClose={() => setEditing(null)} />
      {details && (
        <Dialog open onOpenChange={(open) => !open && setDetails(null)}>
          <DialogContent className="max-md:top-4 max-md:translate-y-0 overflow-x-hidden">
            <DialogHeader><DialogTitle className="break-words">{details.displayName}</DialogTitle></DialogHeader>
            <p className="font-mono text-sm break-all" dir="ltr">{details.key}</p>
            <p>{details.description || t("platformFeatureFlags.details.noDescription")}</p>
            <p className="text-sm">{t("platformFeatureFlags.details.created")}: {details.createdAt.toLocaleString("he-IL")}</p>
            <p className="text-sm">{t("platformFeatureFlags.details.updated")}: {details.updatedAt.toLocaleString("he-IL")}</p>
            <p className="text-sm">{t("platformFeatureFlags.details.notes")}: {details.notes || "—"}</p>
            <DialogFooter><Button onClick={() => setDetails(null)}>{t("common.close")}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {deleting && (
        <AlertDialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("platformFeatureFlags.delete.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("platformFeatureFlags.delete.desc", { name: deleting.displayName })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={() => { actionMut.mutate({ action: "delete", flag: deleting }); setDeleting(null); }}
              >
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function FlagDialog({ flag, onClose }: { flag: FeatureFlag | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { runtime } = usePlatformContext();
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const isNew = !flag?.id;
  const [name, setName] = useState(flag?.displayName ?? "");
  const [key, setKey] = useState(flag?.key ?? "");
  const [description, setDescription] = useState(flag?.description ?? "");
  const [notes, setNotes] = useState(flag?.notes ?? "");
  const [scope, setScope] = useState<"platform" | "company" | "branch">((flag?.scope as "platform" | "company" | "branch") ?? "platform");
  const mut = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !key.trim()) throw new Error(t("platformFeatureFlags.dialog.nameKeyRequired"));
      if (isNew) runtime.registerFeatureFlag({ displayName: name.trim(), key: key.trim(), description: description.trim(), notes: notes.trim() || null, enabled: false, scope, scopeTargetId: null });
      else runtime.updateFeatureFlag(flag.key, { displayName: name.trim(), description: description.trim(), notes: notes.trim() || null, scope, scopeTargetId: null });
      runtime.recordFeatureFlagAudit(isNew ? "feature-flag.create" : "feature-flag.update", (profile?.id ?? "unknown") as UUID, key.trim(), flag, { name, description, notes, scope });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
      toast.success(t("platformFeatureFlags.dialog.saved"));
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open={!!flag} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-md:top-4 max-md:translate-y-0 overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{isNew ? t("platformFeatureFlags.dialog.createTitle") : t("platformFeatureFlags.dialog.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label>
            {t("platformFeatureFlags.dialog.displayName")}
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Label>
          <Label>
            {t("platformFeatureFlags.dialog.key")}
            <Input value={key} disabled={!isNew} dir="ltr" onChange={(event) => setKey(event.target.value)} />
          </Label>
          <Label>
            {t("platformFeatureFlags.dialog.description")}
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </Label>
          <Label>
            {t("platformFeatureFlags.dialog.scope")}
            <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FLAG_SCOPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {scopeLabel(value, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label>
            {t("platformFeatureFlags.dialog.notes")}
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
