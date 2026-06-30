import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

  // Realtime
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
      toast.success("התפקיד נמחק");
      qc.invalidateQueries({ queryKey: ["job-titles"] });
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Briefcase className="size-6" />
            ניהול תפקידים
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            הוספה, עריכה ומחיקה של תפקידים, וקביעה האם תפקיד נכלל בסטטיסטיקות כוח האדם.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="size-4" />
          תפקיד חדש
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {titlesQ.isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="size-6 animate-spin" /></div>
        ) : (titlesQ.data ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            אין עדיין תפקידים. לחצו על "תפקיד חדש" כדי להוסיף.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {(titlesQ.data ?? []).map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-4">
                <Briefcase className="size-5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.excluded_from_headcount
                      ? "לא נכלל בסטטיסטיקות כוח האדם"
                      : "נכלל בסטטיסטיקות כוח האדם"}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditing(t)} className="gap-1.5">
                  <Pencil className="size-3.5" />
                  עריכה
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(t)} className="gap-1.5 text-destructive">
                  <Trash2 className="size-3.5" />
                  מחיקה
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
              <AlertDialogTitle>מחיקת תפקיד</AlertDialogTitle>
              <AlertDialogDescription>
                האם למחוק את התפקיד "{deleting.name}"? עובדים ששויכו לתפקיד זה יחזרו להיכלל בסטטיסטיקות כוח האדם.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => delMut.mutate(deleting.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                מחק
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function EditDialog({ title, onClose }: { title?: JobTitleRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(title?.name ?? "");
  const [excluded, setExcluded] = useState(title?.excluded_from_headcount ?? false);

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        excluded_from_headcount: excluded,
      };
      if (!payload.name) throw new Error("יש להזין שם תפקיד");
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
      toast.success(title ? "התפקיד עודכן" : "התפקיד נוצר");
      qc.invalidateQueries({ queryKey: ["job-titles"] });
      onClose();
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? "");
      if (msg.includes("duplicate") || msg.includes("unique")) {
        toast.error("כבר קיים תפקיד עם שם זה");
      } else {
        toast.error(msg || "שגיאה בשמירה");
      }
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title ? "עריכת תפקיד" : "תפקיד חדש"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium">שם התפקיד</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: מנהל כוח אדם"
              required
              maxLength={80}
            />
          </div>
          <div className="flex items-start justify-between rounded-lg border border-border p-3 gap-3">
            <div>
              <p className="text-sm font-medium">לא נכלל בסטטיסטיקות כוח האדם</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                כאשר מסומן, עובדים בתפקיד זה לא ייספרו במצבת כוח האדם של המחלקות ובספירות
                בוקר / ערב / חופש. הם ימשיכו להופיע ברשימות, בחיפוש, בהרשאות, בסידורים ובכל מסכי הניהול.
              </p>
            </div>
            <Switch checked={excluded} onCheckedChange={setExcluded} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? <Loader2 className="size-4 animate-spin" /> : "שמור"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
