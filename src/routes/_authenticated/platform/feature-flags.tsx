import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

function PlatformFeatureFlagsPage() {
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
      toast.success("הפעולה הושלמה");
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Flag className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">דגלי פיצ'רים (Feature Flags)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            הפעלה/כיבוי של דגלים בהיקף פלטפורמה — דרך ה-Feature Flag Manager הקיים
          </p>
        </div>
        <Button onClick={() => setEditing({} as FeatureFlag)} className="gap-2"><Plus className="size-4" />דגל חדש</Button>
      </header>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש בשם או מפתח" />
        <Select value={scope} onValueChange={setScope}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל ההיקפים</SelectItem><SelectItem value="platform">Platform</SelectItem><SelectItem value="company">Company</SelectItem><SelectItem value="branch">Branch</SelectItem></SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל הסטטוסים</SelectItem><SelectItem value="enabled">פעיל</SelectItem><SelectItem value="disabled">כבוי</SelectItem><SelectItem value="archived">בארכיון</SelectItem></SelectContent></Select>
        <Select value={sort} onValueChange={setSort}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name">שם</SelectItem><SelectItem value="scope">היקף</SelectItem><SelectItem value="status">סטטוס</SelectItem><SelectItem value="updated">עדכון אחרון</SelectItem></SelectContent></Select>
      </div>

      <Card className="card-elevated overflow-hidden">
        {flagsQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">טוען…</div>
        ) : flags.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין דגלי פיצ'רים רשומים
          </div>
        ) : (
          <ul className="divide-y">
            {flags.map((flag) => (
              <li key={flag.key} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{flag.displayName}</span>
                    <span className="font-mono text-sm font-medium" dir="ltr">
                      {flag.key}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {flag.scope}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{flag.updatedAt.toLocaleString("he-IL")} · {flag.updatedBy ?? "System"}</p>
                </div>
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
              </li>
            ))}
          </ul>
        )}
      </Card>
      <FlagDialog flag={editing} onClose={() => setEditing(null)} />
      {details && <Dialog open onOpenChange={(open) => !open && setDetails(null)}><DialogContent><DialogHeader><DialogTitle>{details.displayName}</DialogTitle></DialogHeader><p className="font-mono text-sm" dir="ltr">{details.key}</p><p>{details.description || "ללא תיאור"}</p><p className="text-sm">נוצר: {details.createdAt.toLocaleString("he-IL")}</p><p className="text-sm">עודכן: {details.updatedAt.toLocaleString("he-IL")}</p><p className="text-sm">הערות: {details.notes || "—"}</p><DialogFooter><Button onClick={() => setDetails(null)}>סגירה</Button></DialogFooter></DialogContent></Dialog>}
      {deleting && <AlertDialog open onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>מחיקת דגל</AlertDialogTitle><AlertDialogDescription>האם למחוק את {deleting.displayName}? הפעולה אינה ניתנת לשחזור.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => { actionMut.mutate({ action: "delete", flag: deleting }); setDeleting(null); }}>מחיקה</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
    </div>
  );
}

function FlagDialog({ flag, onClose }: { flag: FeatureFlag | null; onClose: () => void }) {
  const { runtime } = usePlatformContext();
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const isNew = !flag?.id;
  const [name, setName] = useState(flag?.displayName ?? "");
  const [key, setKey] = useState(flag?.key ?? "");
  const [description, setDescription] = useState(flag?.description ?? "");
  const [notes, setNotes] = useState(flag?.notes ?? "");
  const [scope, setScope] = useState<"platform" | "company" | "branch">((flag?.scope as "platform" | "company" | "branch") ?? "platform");
  const mut = useMutation({ mutationFn: async () => {
    if (!name.trim() || !key.trim()) throw new Error("שם ומפתח הם שדות חובה.");
    if (isNew) runtime.registerFeatureFlag({ displayName: name.trim(), key: key.trim(), description: description.trim(), notes: notes.trim() || null, enabled: false, scope, scopeTargetId: null });
    else runtime.updateFeatureFlag(flag.key, { displayName: name.trim(), description: description.trim(), notes: notes.trim() || null, scope, scopeTargetId: null });
    runtime.recordFeatureFlagAudit(isNew ? "feature-flag.create" : "feature-flag.update", (profile?.id ?? "unknown") as UUID, key.trim(), flag, { name, description, notes, scope });
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: FLAGS_QUERY_KEY }); toast.success("הדגל נשמר"); onClose(); }, onError: (error: Error) => toast.error(error.message) });
  return <Dialog open={!!flag} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>{isNew ? "דגל חדש" : "עריכת דגל"}</DialogTitle></DialogHeader><div className="space-y-3"><Label>שם תצוגה<Input value={name} onChange={(event) => setName(event.target.value)} /></Label><Label>מפתח<Input value={key} disabled={!isNew} dir="ltr" onChange={(event) => setKey(event.target.value)} /></Label><Label>תיאור<Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Label><Label>היקף<Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="platform">Platform</SelectItem><SelectItem value="company">Company</SelectItem><SelectItem value="branch">Branch</SelectItem></SelectContent></Select></Label><Label>הערות<Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Label></div><DialogFooter><Button variant="outline" onClick={onClose}>ביטול</Button><Button onClick={() => mut.mutate()} disabled={mut.isPending}>שמירה</Button></DialogFooter></DialogContent></Dialog>;
}
