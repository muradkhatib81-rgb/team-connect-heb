import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useCanManageEom } from "@/lib/use-eom-perm";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  buildRolling12MonthSlots,
  eomMonthKey,
  formatEomMonthLabel,
  HEBREW_MONTHS,
} from "@/lib/eom-month";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trophy, Plus, Pencil, Trash2, Loader2, Upload, History, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";

export const Route = createFileRoute("/_authenticated/employee-of-month")({
  component: EomManagePage,
});

type Row = {
  id: string;
  year: number;
  month: number;
  employee_id: string;
  reason: string | null;
  image_url: string | null;
  created_at: string;
};
type Profile = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  departments: { name: string } | null;
};

async function signUrl(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

function EomManagePage() {
  const { t } = useTranslation();
  const { data: me } = useAuth();
  const canManage = useCanManageEom();
  const { activeBranchId } = useActiveBranch();
  const qc = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const rolling12Months = useMemo(() => buildRolling12MonthSlots(now), []);
  const historyCutoff = rolling12Months[rolling12Months.length - 1];
  const historyCutoffKey = eomMonthKey(historyCutoff.year, historyCutoff.month);

  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear() + 1; y >= 2023; y--) arr.push(y);
    return arr;
  }, []);

  const monthQ = useQuery({
    queryKey: ["eom-manage", year, month],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("employee_of_month")
        .select("id, year, month, employee_id, reason, image_url, created_at")
        .eq("year", year).eq("month", month)
        .order("created_at");
      if (error) throw error;
      const list = (rows ?? []) as Row[];
      const ids = Array.from(new Set(list.map((r) => r.employee_id)));
      const profiles: Record<string, Profile> = {};
      if (ids.length) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, job_title, departments(name)")
          .in("id", ids);
        (ps ?? []).forEach((p: any) => (profiles[p.id] = p));
      }
      const imgs = await Promise.all(list.map(async (r) => [r.id, await signUrl("employee-of-month", r.image_url)] as const));
      const avs = await Promise.all(ids.map(async (id) => [id, await signUrl("avatars", profiles[id]?.avatar_url ?? null)] as const));
      return {
        list,
        profiles,
        images: Object.fromEntries(imgs) as Record<string, string | null>,
        avatars: Object.fromEntries(avs) as Record<string, string | null>,
      };
    },
  });

  const historyQ = useQuery({
    enabled: canManage,
    queryKey: ["eom-history", activeBranchId, historyCutoffKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_of_month")
        .select("id, year, month, employee_id, reason")
        .gte("year", historyCutoff.year)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(120);
      if (error) throw error;
      const list = ((data ?? []) as Row[]).filter(
        (row) => eomMonthKey(row.year, row.month) >= historyCutoffKey,
      );
      const ids = Array.from(new Set(list.map((r) => r.employee_id)));
      const profiles: Record<string, Profile> = {};
      if (ids.length) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, full_name, job_title, departments(name)")
          .in("id", ids);
        (ps ?? []).forEach((p: any) => (profiles[p.id] = p));
      }
      return { list, profiles };
    },
  });

  const yearLog = useMemo(() => {
    const grouped = new Map<string, Row[]>();
    for (const row of historyQ.data?.list ?? []) {
      const key = `${row.year}-${row.month}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }
    return rolling12Months.map((slot) => {
      const key = `${slot.year}-${slot.month}`;
      const winners = grouped.get(key) ?? [];
      return { ...slot, winners };
    });
  }, [historyQ.data?.list, rolling12Months]);

  const employeesQ = useQuery({
    enabled: canManage,
    queryKey: ["eom-employees-pool"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, id_number, department_id, branch_id, departments(name)")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return ((data ?? []) as {
        id: string;
        full_name: string;
        id_number: string | null;
        department_id: string | null;
        branch_id: string | null;
        departments: { name: string } | null;
      }[]).filter((p) => !isNonEmployeeIdentity(p));
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (row: Row) => {
      if (row.image_url) {
        await supabase.storage.from("employee-of-month").remove([row.image_url]).catch(() => {});
      }
      const { error } = await supabase.from("employee_of_month").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("employeeOfMonthPage.removed"));
      qc.invalidateQueries({ queryKey: ["eom-manage"] });
      qc.invalidateQueries({ queryKey: ["eom-history"] });
      qc.invalidateQueries({ queryKey: ["eom", "current"] });
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e?.message ?? t("employeeOfMonthPage.removeError")),
  });

  if (!me) return null;

  const listCount = monthQ.data?.list.length ?? 0;

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-10 shrink-0 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Trophy className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("employeeOfMonthPage.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("employeeOfMonthPage.subtitle")}</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} className="shrink-0 gap-2">
            <Plus className="size-4" />
            {t("employeeOfMonthPage.addEmployee")}
          </Button>
        )}
      </header>

      <Card className="card-elevated p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>{t("employeeOfMonthPage.monthLabel")}</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HEBREW_MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("employeeOfMonthPage.yearLabel")}</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          {listCount >= 2 ? t("employeeOfMonthPage.employeesOfMonth") : t("employeeOfMonthPage.employeeOfMonth")}
          <span className="text-sm font-normal text-muted-foreground mr-2">
            {t("employeeOfMonthPage.monthYear", { month: HEBREW_MONTHS[month - 1], year })}
          </span>
        </h2>
        {monthQ.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
        ) : listCount === 0 ? (
          <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
            {t("employeeOfMonthPage.noWinners")}
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {monthQ.data!.list.map((r) => {
              const p = monthQ.data!.profiles[r.employee_id];
              const img = monthQ.data!.images[r.id] ?? monthQ.data!.avatars[r.employee_id] ?? null;
              return (
                <Card key={r.id} className="card-elevated p-5 text-center bg-gradient-to-b from-amber-50/60 to-background dark:from-amber-950/20 border-amber-200/60">
                  <div className="flex justify-center mb-3">
                    <div className="size-24 rounded-full overflow-hidden ring-4 ring-amber-300/60 bg-accent flex items-center justify-center text-3xl font-bold shadow-md">
                      {img ? (
                        <img src={img} alt={p?.full_name ?? ""} className="size-full object-cover" />
                      ) : (
                        <span>{(p?.full_name ?? "?").charAt(0)}</span>
                      )}
                    </div>
                  </div>
                  <Trophy className="size-5 text-amber-500 mx-auto mb-1" />
                  <h3 className="font-bold truncate">{p?.full_name ?? "—"}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p?.departments?.name ?? "—"}{p?.job_title ? ` · ${p.job_title}` : ""}
                  </p>
                  {r.reason && <p className="text-sm mt-3 text-foreground/80 whitespace-pre-wrap break-words">{r.reason}</p>}
                  {canManage && (
                    <div className="flex gap-2 justify-center mt-4">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)} className="gap-1">
                        <Pencil className="size-3.5" />{t("employeeOfMonthPage.edit")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeleting(r)} className="gap-1 text-destructive hover:text-destructive">
                        <Trash2 className="size-3.5" />{t("employeeOfMonthPage.remove")}
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {canManage && (
        <section>
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <History className="size-5 text-primary" />
            {t("employeeOfMonthPage.historyTitle")}
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            {t("employeeOfMonthPage.historyRange", {
              from: formatEomMonthLabel(rolling12Months[0].year, rolling12Months[0].month),
              to: formatEomMonthLabel(
                rolling12Months[rolling12Months.length - 1].year,
                rolling12Months[rolling12Months.length - 1].month,
              ),
            })}
          </p>
          <Card className="card-elevated divide-y overflow-hidden">
            {historyQ.isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : (
              yearLog.map((slot) => {
                const isSelected = slot.year === year && slot.month === month;
                return (
                  <div
                    key={`${slot.year}-${slot.month}`}
                    className={`p-3 sm:p-4 ${isSelected ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          setYear(slot.year);
                          setMonth(slot.month);
                        }}
                        className={`text-sm font-semibold tabular-nums hover:underline ${
                          isSelected ? "text-primary" : ""
                        }`}
                      >
                        {formatEomMonthLabel(slot.year, slot.month)}
                      </button>
                      {isSelected && (
                        <span className="text-xs text-primary font-medium">{t("employeeOfMonthPage.selectedMonth")}</span>
                      )}
                    </div>
                    {slot.winners.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("employeeOfMonthPage.noWinnerForMonth")}</p>
                    ) : (
                      <div className="space-y-2">
                        {slot.winners.map((row) => {
                          const p = historyQ.data?.profiles[row.employee_id];
                          return (
                            <div
                              key={row.id}
                              className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3 text-sm"
                            >
                              <span className="font-medium truncate">{p?.full_name ?? "—"}</span>
                              <span className="text-xs text-muted-foreground truncate">
                                {[p?.departments?.name, p?.job_title].filter(Boolean).join(" · ") ||
                                  "—"}
                              </span>
                              {row.reason && (
                                <span className="text-xs text-foreground/80 sm:mr-auto truncate">
                                  {row.reason}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </Card>
        </section>
      )}

      {canManage && addOpen && (
        <EomEditDialog
          mode="create"
          year={year}
          month={month}
          existingIds={new Set((monthQ.data?.list ?? []).map((r) => r.employee_id))}
          employees={employeesQ.data ?? []}
          onClose={() => setAddOpen(false)}
        />
      )}
      {canManage && editing && (
        <EomEditDialog
          mode="edit"
          row={editing}
          year={editing.year}
          month={editing.month}
          existingIds={new Set()}
          employees={employeesQ.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("employeeOfMonthPage.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("employeeOfMonthPage.removeDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMut.mutate(deleting)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("employeeOfMonthPage.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type EomEmployeeOption = {
  id: string;
  full_name: string;
  id_number: string | null;
  departments: { name: string } | null;
};

function EomEditDialog({
  mode, row, year, month, existingIds, employees, onClose,
}: {
  mode: "create" | "edit";
  row?: Row;
  year: number;
  month: number;
  existingIds: Set<string>;
  employees: EomEmployeeOption[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const [employeeId, setEmployeeId] = useState<string>(row?.employee_id ?? "");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [reason, setReason] = useState<string>(row?.reason ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);

  const pool = useMemo(
    () => employees.filter((e) => mode === "edit" || !existingIds.has(e.id)),
    [employees, existingIds, mode],
  );

  const filteredPool = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((e) => {
      const name = (e.full_name ?? "").toLowerCase();
      const idn = (e.id_number ?? "").toLowerCase();
      return name.includes(q) || idn.includes(q);
    });
  }, [pool, employeeSearch]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  );

  async function uploadImageFor(rowId: string): Promise<string | null> {
    if (!file) return null;
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${rowId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("employee-of-month").upload(path, file, {
      upsert: true, contentType: file.type || undefined,
    });
    if (error) throw new Error(error.message);
    return path;
  }

  async function handleSave() {
    if (!employeeId) { toast.error(t("employeeOfMonthPage.errSelectEmployee")); return; }
    setSaving(true);
    try {
      if (mode === "create") {
        const { data: inserted, error } = await supabase
          .from("employee_of_month")
          .insert({ year, month, employee_id: employeeId, reason: reason.trim() || null, created_by: me?.id })
          .select("id").single();
        if (error) {
          if ((error as any).code === "23505") throw new Error(t("employeeOfMonthPage.errAlreadySelected"));
          throw error;
        }
        if (file) {
          const path = await uploadImageFor(inserted!.id);
          if (path) {
            await supabase.from("employee_of_month").update({ image_url: path }).eq("id", inserted!.id);
          }
        }
      } else if (row) {
        let imagePath: string | null | undefined = undefined;
        if (removeImage) {
          if (row.image_url) await supabase.storage.from("employee-of-month").remove([row.image_url]).catch(() => {});
          imagePath = null;
        }
        if (file) {
          if (row.image_url) await supabase.storage.from("employee-of-month").remove([row.image_url]).catch(() => {});
          imagePath = await uploadImageFor(row.id);
        }
        const update: { reason: string | null; image_url?: string | null } = { reason: reason.trim() || null };
        if (imagePath !== undefined) update.image_url = imagePath;
        const { error } = await supabase.from("employee_of_month").update(update).eq("id", row.id);
        if (error) throw error;
      }
      toast.success(mode === "create" ? t("employeeOfMonthPage.added") : t("employeeOfMonthPage.updated"));
      qc.invalidateQueries({ queryKey: ["eom-manage"] });
      qc.invalidateQueries({ queryKey: ["eom-history"] });
      qc.invalidateQueries({ queryKey: ["eom", "current"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? t("employeeOfMonthPage.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("employeeOfMonthPage.createTitle") : t("employeeOfMonthPage.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("employeeOfMonthPage.employeeLabel")}</Label>
            {mode === "edit" ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-medium">{selectedEmployee?.full_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("employeeOfMonthPage.idNumberPrefix")} {selectedEmployee?.id_number || "—"}
                  {selectedEmployee?.departments?.name
                    ? ` · ${selectedEmployee.departments.name}`
                    : ""}
                </div>
              </div>
            ) : (
              <>
                <Input
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder={t("employeeOfMonthPage.searchPlaceholder")}
                  autoComplete="off"
                />
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
                  {pool.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground text-center">
                      {t("employeeOfMonthPage.allSelected")}
                    </p>
                  ) : filteredPool.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground text-center">
                      {t("employeeOfMonthPage.noSearchResults")}
                    </p>
                  ) : (
                    filteredPool.map((e) => {
                      const active = e.id === employeeId;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setEmployeeId(e.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-right text-sm transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          }`}
                        >
                          <span className="min-w-0 truncate font-medium">
                            {e.full_name}
                            {e.departments?.name ? (
                              <span className={`font-normal ${active ? "opacity-80" : "text-muted-foreground"}`}>
                                {` · ${e.departments.name}`}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={`shrink-0 tabular-nums text-xs ${
                              active ? "opacity-80" : "text-muted-foreground"
                            }`}
                          >
                            {e.id_number || "—"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
          <div className="space-y-1">
            <Label>{t("employeeOfMonthPage.reasonLabel")}</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("employeeOfMonthPage.reasonPlaceholder")}
              rows={3}
              maxLength={500}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("employeeOfMonthPage.imageLabel")}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemoveImage(false); }}
              />
              {mode === "edit" && row?.image_url && !file && !removeImage && (
                <Button type="button" size="sm" variant="outline" onClick={() => setRemoveImage(true)} className="gap-1 shrink-0">
                  <ImageOff className="size-4" />
                  {t("common.remove")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("employeeOfMonthPage.imageHint")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
