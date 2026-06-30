import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Plus, Pencil, Trash2, UserCog, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  listBranchesWithStats,
  listEmployeesForManagerPicker,
  createBranch,
  updateBranch,
  deleteBranch,
  getBranchDeleteBlockers,
  assignBranchManager,
} from "@/lib/branches.functions";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Branch = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  manager_id: string | null;
  manager_name: string | null;
  employees_count: number;
  departments_count: number;
  active_schedules_count: number;
};

type SortKey = "name" | "code" | "employees" | "departments" | "created";
type FilterStatus = "all" | "active" | "inactive";

export const Route = createFileRoute("/_authenticated/system/branches")({
  component: BranchesPage,
});

function BranchesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBranchesWithStats);

  const branchesQ = useQuery({
    queryKey: ["system", "branches"],
    queryFn: () => list({}),
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FilterStatus>("all");
  const [sort, setSort] = useState<SortKey>("created");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [managing, setManaging] = useState<Branch | null>(null);
  const [copyPrompt, setCopyPrompt] = useState<{ newId: string } | null>(null);

  const branches = (branchesQ.data ?? []) as Branch[];

  const filtered = useMemo(() => {
    let arr = branches.filter((b) => {
      if (status === "active" && !b.is_active) return false;
      if (status === "inactive" && b.is_active) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        (b.address ?? "").toLowerCase().includes(q) ||
        (b.phone ?? "").toLowerCase().includes(q) ||
        (b.manager_name ?? "").toLowerCase().includes(q)
      );
    });
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case "name": return a.name.localeCompare(b.name, "he");
        case "code": return a.code.localeCompare(b.code);
        case "employees": return b.employees_count - a.employees_count;
        case "departments": return b.departments_count - a.departments_count;
        case "created":
        default:
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
    });
    return arr;
  }, [branches, search, status, sort]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-xl gradient-brand flex items-center justify-center shadow-soft">
            <Building2 className="size-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">סניפים</h1>
            <p className="text-sm text-muted-foreground">ניהול כלל סניפי הרשת</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> סניף חדש
        </Button>
      </div>

      <Card className="p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="relative">
            <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם, קוד, כתובת, טלפון או מנהל"
              className="pr-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as FilterStatus)}>
            <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              <SelectItem value="active">פעיל</SelectItem>
              <SelectItem value="inactive">לא פעיל</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger><SelectValue placeholder="מיון" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created">תאריך יצירה</SelectItem>
              <SelectItem value="name">שם</SelectItem>
              <SelectItem value="code">קוד</SelectItem>
              <SelectItem value="employees">מס' עובדים</SelectItem>
              <SelectItem value="departments">מס' מחלקות</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {branchesQ.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">לא נמצאו סניפים</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((b) => (
            <Card key={b.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-lg truncate">{b.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{b.code}</div>
                </div>
                <Badge variant={b.is_active ? "default" : "secondary"}>
                  {b.is_active ? "פעיל" : "לא פעיל"}
                </Badge>
              </div>
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">כתובת: </span>{b.address || "—"}</div>
                <div><span className="text-muted-foreground">טלפון: </span>{b.phone || "—"}</div>
                <div><span className="text-muted-foreground">מנהל סניף: </span>{b.manager_name || "—"}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm border-t pt-3">
                <div>
                  <div className="font-bold">{b.employees_count}</div>
                  <div className="text-xs text-muted-foreground">עובדים</div>
                </div>
                <div>
                  <div className="font-bold">{b.departments_count}</div>
                  <div className="text-xs text-muted-foreground">מחלקות</div>
                </div>
                <div>
                  <div className="font-bold">{b.active_schedules_count}</div>
                  <div className="text-xs text-muted-foreground">סידורים פעילים</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                נוצר: {new Date(b.created_at).toLocaleDateString("he-IL")}
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" onClick={() => setEditing(b)}>
                  <Pencil className="size-3.5" /> עריכה
                </Button>
                <Button size="sm" variant="outline" onClick={() => setManaging(b)}>
                  <UserCog className="size-3.5" /> מנהל סניף
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setDeleting(b)}>
                  <Trash2 className="size-3.5" /> מחק
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <BranchFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["system", "branches"] });
          setCopyPrompt({ newId: id });
        }}
      />

      {editing && (
        <BranchFormDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          branch={editing}
          onUpdated={() => {
            qc.invalidateQueries({ queryKey: ["system", "branches"] });
            setEditing(null);
          }}
        />
      )}

      {managing && (
        <ManagerDialog
          branch={managing}
          onClose={() => setManaging(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["system", "branches"] });
            setManaging(null);
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          branch={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["system", "branches"] });
            setDeleting(null);
          }}
        />
      )}

      {copyPrompt && (
        <CopyDepartmentsDialog
          newBranchId={copyPrompt.newId}
          branches={branches.filter((b) => b.id !== copyPrompt.newId)}
          onClose={() => setCopyPrompt(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["system", "branches"] });
            setCopyPrompt(null);
          }}
        />
      )}
    </div>
  );
}

function BranchFormDialog({
  open,
  onOpenChange,
  branch,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branch?: Branch;
  onCreated?: (id: string) => void;
  onUpdated?: () => void;
}) {
  const isEdit = !!branch;
  const create = useServerFn(createBranch);
  const update = useServerFn(updateBranch);

  const [name, setName] = useState(branch?.name ?? "");
  const [code, setCode] = useState(branch?.code ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [isActive, setIsActive] = useState(branch?.is_active ?? true);

  const m = useMutation({
    mutationFn: async () => {
      if (isEdit && branch) {
        return update({
          data: {
            id: branch.id,
            name: name.trim(),
            code: code.trim(),
            address: address.trim() || null,
            phone: phone.trim() || null,
            is_active: isActive,
          },
        });
      }
      return create({
        data: {
          name: name.trim(),
          code: code.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          is_active: isActive,
        },
      });
    },
    onSuccess: (res: any) => {
      toast.success(isEdit ? "הסניף עודכן" : "הסניף נוצר");
      if (isEdit) onUpdated?.();
      else onCreated?.(res.id);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "עריכת סניף" : "סניף חדש"}</DialogTitle>
          <DialogDescription>פרטי הסניף</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>שם הסניף</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div>
            <Label>קוד סניף (ייחודי)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} className="font-mono" />
          </div>
          <div>
            <Label>כתובת</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label>טלפון</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium">סטטוס</div>
              <div className="text-xs text-muted-foreground">סניף לא פעיל חוסם כניסת עובדים, יצירת סידורים ודיווחים</div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button
            onClick={() => m.mutate()}
            disabled={m.isPending || !name.trim() || !code.trim()}
          >
            {m.isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "שמור שינויים" : "צור סניף"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyDepartmentsDialog({
  newBranchId,
  branches,
  onClose,
  onDone,
}: {
  newBranchId: string;
  branches: Branch[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"ask" | "pick">("ask");
  const [sourceId, setSourceId] = useState<string>("");
  const updateB = useServerFn(updateBranch);
  const create = useServerFn(createBranch);
  // We can't re-call create. Instead we replay the copy by inserting departments
  // via a dedicated path: simplest is to call createBranch is not possible.
  // Use a small inline server call: reuse updateBranch is wrong. Add a server fn? -
  // Simpler: call createBranch path was for first create. For copy after-the-fact
  // we just call a small wrapper using updateBranch noop is wrong. We added copy
  // inside createBranch; for the post-create flow do it through a fresh call:
  // we'll reuse createBranch is not safe (creates new branch).
  // Instead implement copy via direct supabase client (system_admin only is
  // enforced by RLS on departments).
  const m = useMutation({
    mutationFn: async () => {
      if (!sourceId) return { ok: true };
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: srcDepts, error } = await supabase
        .from("departments")
        .select("name,code,is_active")
        .eq("branch_id", sourceId);
      if (error) throw new Error(error.message);
      if (!srcDepts || srcDepts.length === 0) return { ok: true };
      const suffix = Math.random().toString(36).slice(2, 6);
      const rows = srcDepts.map((d: any) => ({
        name: d.name,
        code: `${d.code}_${suffix}`,
        is_active: d.is_active,
        branch_id: newBranchId,
        manager_id: null,
      }));
      const { error: iErr } = await supabase.from("departments").insert(rows);
      if (iErr) throw new Error(iErr.message);
      return { ok: true };
    },
    onSuccess: () => {
      toast.success("מבנה המחלקות הועתק");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בהעתקה"),
  });
  // Silence unused
  void updateB; void create;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>העתקת מבנה מחלקות</DialogTitle>
          <DialogDescription>
            {step === "ask"
              ? "האם ברצונך להעתיק את מבנה המחלקות מסניף קיים?"
              : "בחר את הסניף שממנו יועתק מבנה המחלקות. עובדים, סידורים, משימות והודעות לא יועתקו."}
          </DialogDescription>
        </DialogHeader>
        {step === "pick" && (
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger><SelectValue placeholder="בחר סניף מקור" /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name} ({b.departments_count} מחלקות)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          {step === "ask" ? (
            <>
              <Button variant="outline" onClick={onDone}>לא, סניף ריק</Button>
              <Button onClick={() => setStep("pick")}>כן, העתק מבנה</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onDone}>דלג</Button>
              <Button onClick={() => m.mutate()} disabled={!sourceId || m.isPending}>
                {m.isPending && <Loader2 className="size-4 animate-spin" />}
                העתק מחלקות
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManagerDialog({
  branch,
  onClose,
  onSaved,
}: {
  branch: Branch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const listEmp = useServerFn(listEmployeesForManagerPicker);
  const assign = useServerFn(assignBranchManager);
  const empQ = useQuery({
    queryKey: ["system", "branches", "manager-picker"],
    queryFn: () => listEmp({}),
  });
  const [managerId, setManagerId] = useState<string>(branch.manager_id ?? "__none__");

  const m = useMutation({
    mutationFn: () =>
      assign({
        data: {
          branch_id: branch.id,
          manager_id: managerId === "__none__" ? null : managerId,
        },
      }),
    onSuccess: () => {
      toast.success("מנהל הסניף עודכן");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>מנהל סניף — {branch.name}</DialogTitle>
          <DialogDescription>עובד אחד יכול לנהל סניף אחד בלבד</DialogDescription>
        </DialogHeader>
        {empQ.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <Select value={managerId} onValueChange={setManagerId}>
            <SelectTrigger><SelectValue placeholder="בחר עובד" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— ללא מנהל סניף —</SelectItem>
              {((empQ.data ?? []) as any[]).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  branch,
  onClose,
  onDeleted,
}: {
  branch: Branch;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = useServerFn(deleteBranch);
  const m = useMutation({
    mutationFn: () => del({ data: { id: branch.id } }),
    onSuccess: (res: any) => {
      if (res?.ok && res?.deleted) {
        toast.success(`הסניף "${branch.name}" נמחק בהצלחה`);
        onDeleted();
        return;
      }
      const message =
        (typeof res?.message === "string" && res.message.trim()) ||
        "לא ניתן למחוק את הסניף כעת. נסה שוב מאוחר יותר.";
      const [first, ...rest] = message.split("\n");
      toast.error(first, {
        description: rest.length ? rest.join("\n") : undefined,
        duration: 8000,
      });
    },
    onError: (e: any) => {
      console.error("[DeleteBranch] unexpected error:", e);
      toast.error("אירעה שגיאה לא צפויה במחיקת הסניף. נסה שוב מאוחר יותר.", {
        duration: 8000,
      });
    },
  });
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת סניף "{branch.name}"</AlertDialogTitle>
          <AlertDialogDescription>
            ניתן למחוק סניף רק כאשר אין בו עובדים, מחלקות, סידורים ומשימות.
            הפעולה אינה ניתנת לביטול.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); m.mutate(); }}
            disabled={m.isPending}
          >
            {m.isPending && <Loader2 className="size-4 animate-spin" />}
            מחק סניף
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
