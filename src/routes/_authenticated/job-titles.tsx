import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useJobTitles, type JobTitleRow } from "@/lib/use-job-titles";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Briefcase, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/job-titles")({
  component: JobTitlesPage,
});

function JobTitlesPage() {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const navigate = useNavigate();
  const isMainAdmin = !!profile?.roles?.includes("main_admin");
  const qc = useQueryClient();
  const titlesQ = useJobTitles();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<JobTitleRow | null>(null);
  const [deleting, setDeleting] = useState<JobTitleRow | null>(null);

  useEffect(() => {
    if (profile && !isMainAdmin) navigate({ to: "/dashboard" });
  }, [profile, isMainAdmin, navigate]);

  useEffect(() => {
    const ch = supabase
      .channel("job-titles-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_titles" }, () => {
        qc.invalidateQueries({ queryKey: ["job-titles"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("job_titles" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("jobTitlesPage.deleted"));
      qc.invalidateQueries({ queryKey: ["job-titles"] });
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e?.message ?? t("jobTitlesPage.deleteError")),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Briefcase className="size-6" />
            {t("jobTitlesPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("jobTitlesPage.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="size-4" />
          {t("jobTitlesPage.newJobTitle")}
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {titlesQ.isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="size-6 animate-spin" /></div>
        ) : (titlesQ.data ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("jobTitlesPage.emptyState")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {(titlesQ.data ?? []).map((titleRow) => (
              <li key={titleRow.id} className="flex items-center gap-3 p-4">
                <Briefcase className="size-5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{titleRow.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {titleRow.excluded_from_headcount
                      ? t("jobTitlesPage.excludedFromHeadcount")
                      : t("jobTitlesPage.includedInHeadcount")}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditing(titleRow)} className="gap-1.5">
                  <Pencil className="size-3.5" />
                  {t("common.edit")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(titleRow)} className="gap-1.5 text-destructive">
                  <Trash2 className="size-3.5" />
                  {t("common.delete")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {createOpen && <EditDialog onClose={() => setCreateOpen(false)} />}
      {editing && <EditDialog title={editing} onClose={() => setEditing(null)} />}

      {deleting && (
        <AlertDialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("jobTitlesPage.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("jobTitlesPage.deleteDesc", { name: deleting.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => delMut.mutate(deleting.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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

function EditDialog({ title, onClose }: { title?: JobTitleRow; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(title?.name ?? "");
  const [excluded, setExcluded] = useState(title?.excluded_from_headcount ?? false);

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        excluded_from_headcount: excluded,
      };
      if (!payload.name) throw new Error(t("jobTitlesPage.errNameRequired"));
      if (title) {
        const { error } = await supabase
          .from("job_titles" as any)
          .update(payload)
          .eq("id", title.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("job_titles" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(title ? t("jobTitlesPage.updated") : t("jobTitlesPage.created"));
      qc.invalidateQueries({ queryKey: ["job-titles"] });
      onClose();
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? "");
      if (msg.includes("duplicate") || msg.includes("unique")) {
        toast.error(t("jobTitlesPage.duplicateName"));
      } else {
        toast.error(msg || t("jobTitlesPage.saveError"));
      }
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title ? t("jobTitlesPage.editTitle") : t("jobTitlesPage.createTitle")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("jobTitlesPage.jobTitleName")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("jobTitlesPage.jobTitlePlaceholder")}
              required
              maxLength={80}
            />
          </div>
          <div className="flex items-start justify-between rounded-lg border border-border p-3 gap-3">
            <div>
              <p className="text-sm font-medium">{t("jobTitlesPage.excludeFromHeadcount")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("jobTitlesPage.excludeHint")}
              </p>
            </div>
            <Switch checked={excluded} onCheckedChange={setExcluded} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
