import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  hasBranchActionPermission,
  useCurrentPermissions,
} from "@/lib/use-current-permissions";
import { useShiftDefinitions, type ShiftDef } from "@/lib/use-shift-definitions";
import { useSchedulePeriodConfig } from "@/lib/use-schedule-period-config";
import { useActiveBranch } from "@/lib/use-active-branch";
import { getScheduleDayNames } from "@/lib/schedule-week";
import { getShiftHoursDows, normalizeMonthlyWorkingDows, type ScheduleDow } from "@/lib/schedule-period-config";
import { formatShiftTimeRange } from "@/lib/shift-hours";
import { buildCompanySettingsPeriodUpdate } from "@/lib/schedule-period-settings";
import type { ScheduleType } from "@/lib/use-company-settings";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Time24Input } from "@/components/ui/time24-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
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
import { toast } from "sonner";
import { supportContactInstruction } from "@/lib/constants";
import {
  Clock,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  Lock,
  CalendarRange,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/shift-settings")({
  component: ShiftSettingsPage,
});

const PRESET_COLORS = [
  "#f59e0b", "#0ea5e9", "#10b981", "#6366f1", "#ef4444",
  "#a855f7", "#14b8a6", "#f43f5e", "#64748b", "#0f172a",
];

type DayHourInput = { day_of_week: ScheduleDow; start_time: string; end_time: string };

function slugifyCode(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05FF]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return base || `shift_${Date.now()}`;
}

function hmFromDb(value: string | null | undefined): string {
  return value ? String(value).slice(0, 5) : "";
}

function hmToDb(value: string): string | null {
  const v = value.trim();
  return v ? `${v}:00` : null;
}

function summarizeShiftHours(
  def: ShiftDef,
  dayRows: Array<{ day_of_week: number; start_time: string | null; end_time: string | null }>,
  periodDows: ScheduleDow[],
): string {
  const filtered = dayRows.filter((r) => periodDows.includes(r.day_of_week as ScheduleDow));
  if (!def.start_time && !def.end_time && filtered.length === 0) {
    return "ללא שעות (לדוגמה: חופש)";
  }
  if (filtered.length === 0 && def.start_time && def.end_time) {
    return `${hmFromDb(def.start_time)} – ${hmFromDb(def.end_time)}`;
  }
  const normalized = filtered.map((r) => ({
    start: hmFromDb(r.start_time),
    end: hmFromDb(r.end_time),
  }));
  const rangeLabels = normalized
    .map((r) => formatShiftTimeRange(r.start, r.end))
    .filter(Boolean);
  if (rangeLabels.length === 0 && def.start_time) {
    return formatShiftTimeRange(hmFromDb(def.start_time), hmFromDb(def.end_time)) ?? "ללא שעות";
  }
  const first = rangeLabels[0];
  const allSame = rangeLabels.every((r) => r === first);
  if (allSame && first) return first;
  return "שעות שונות לפי יום";
}

function buildDayHoursState(
  periodDows: ScheduleDow[],
  initialDayHours: Array<{ day_of_week: number; start_time: string | null; end_time: string | null }> | undefined,
  initial: Partial<ShiftDef> | undefined,
): DayHourInput[] {
  const byDow = new Map((initialDayHours ?? []).map((r) => [r.day_of_week, r]));
  const flatStart = hmFromDb(initial?.start_time) || "07:00";
  const flatEnd = hmFromDb(initial?.end_time);
  return periodDows.map((dow) => {
    const existing = byDow.get(dow);
    return {
      day_of_week: dow,
      start_time: existing ? hmFromDb(existing.start_time) : flatStart,
      end_time: existing ? hmFromDb(existing.end_time) : flatEnd,
    };
  });
}

function ShiftSettingsPage() {
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const periodConfigQ = useSchedulePeriodConfig();
  const { activeBranchId } = useActiveBranch();
  const permissionsQ = useCurrentPermissions(me?.id);

  const listQ = useShiftDefinitions();
  const rows = listQ.all;
  const dayNames = useMemo(() => getScheduleDayNames(), []);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftDef | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShiftDef | null>(null);

  const [periodType, setPeriodType] = useState<ScheduleType>("weekly");
  const [weekStartDow, setWeekStartDow] = useState("0");
  const [weekEndDow, setWeekEndDow] = useState("6");
  const [monthlyWorkingDows, setMonthlyWorkingDows] = useState<ScheduleDow[]>([0, 1, 2, 3, 4, 5, 6]);
  const periodFormDirtyRef = useRef(false);
  const periodHydratedRef = useRef(false);

  const markPeriodDirty = () => {
    periodFormDirtyRef.current = true;
  };

  const periodDows = useMemo(
    () =>
      getShiftHoursDows({
        schedule_type: periodType,
        week_start_dow: Number(weekStartDow) as ScheduleDow,
        week_end_dow: Number(weekEndDow) as ScheduleDow,
        monthly_working_dows: monthlyWorkingDows,
      }),
    [periodType, weekStartDow, weekEndDow, monthlyWorkingDows],
  );

  useEffect(() => {
    if (!periodConfigQ.isSuccess || periodFormDirtyRef.current) return;
    const cfg = periodConfigQ.data;
    if (!cfg) return;
    setPeriodType(cfg.schedule_type ?? "weekly");
    setWeekStartDow(String(cfg.week_start_dow ?? 0));
    setWeekEndDow(String(cfg.week_end_dow ?? 6));
    setMonthlyWorkingDows(normalizeMonthlyWorkingDows(cfg.monthly_working_dows));
    periodHydratedRef.current = true;
  }, [periodConfigQ.isSuccess, periodConfigQ.dataUpdatedAt, periodConfigQ.data]);

  const periodSaveMut = useMutation({
    mutationFn: async () => {
      const workingDows = normalizeMonthlyWorkingDows(monthlyWorkingDows);
      if (periodType === "monthly" && workingDows.length === 0) {
        throw new Error("יש לבחור לפחות יום עבודה אחד");
      }
      const { data: existing, error: fetchErr } = await supabase
        .from("company_settings" as any)
        .select("id, extra")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const payload = buildCompanySettingsPeriodUpdate((existing as any)?.extra, {
        schedule_type: periodType,
        week_start_dow: Number(weekStartDow),
        week_end_dow: Number(weekEndDow),
        monthly_working_dows: workingDows,
      });

      const { data: rpcId, error: rpcErr } = await supabase.rpc("save_schedule_period_settings" as any, {
        p_schedule_type: payload.schedule_type,
        p_week_start_dow: payload.week_start_dow,
        p_week_end_dow: payload.week_end_dow,
        p_monthly_working_dows: payload.monthly_working_dows,
        p_extra: payload.extra,
        p_branch_id: activeBranchId ?? null,
      });
      if (!rpcErr && rpcId) return;

      const corePayload = {
        schedule_type: payload.schedule_type,
        extra: payload.extra,
      };
      const columnPayload = {
        week_start_dow: payload.week_start_dow,
        week_end_dow: payload.week_end_dow,
        monthly_working_dows: payload.monthly_working_dows,
      };
      const existingId = (existing as any)?.id as string | undefined;
      if (existingId) {
        const { error: coreErr } = await supabase
          .from("company_settings" as any)
          .update(corePayload)
          .eq("id", existingId);
        if (coreErr) {
          if (/save_schedule_period_settings|function/i.test(coreErr.message ?? "") && rpcErr) {
            throw rpcErr;
          }
          throw coreErr;
        }
        await supabase
          .from("company_settings" as any)
          .update(columnPayload)
          .eq("id", existingId);
      } else {
        const { error } = await supabase
          .from("company_settings" as any)
          .insert({ ...corePayload, ...columnPayload, is_active: true });
        if (error) {
          if (rpcErr) throw rpcErr;
          throw error;
        }
      }
    },
    onSuccess: () => {
      periodFormDirtyRef.current = false;
      toast.success("הגדרות תקופת הסידור נשמרו — חלות מיד על סידורי העבודה");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
      qc.invalidateQueries({ queryKey: ["schedule-period-config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  async function upsertDayHours(
    shiftId: string,
    dayHours: DayHourInput[],
    hasTimes: boolean,
    allowedDows: ScheduleDow[],
  ) {
    if (!hasTimes) {
      const { error } = await supabase.from("shift_definition_day_hours" as any).delete().eq("shift_definition_id", shiftId);
      if (error && !/shift_definition_day_hours|relation|schema cache/i.test(error.message ?? "")) throw error;
      return;
    }
    for (const row of dayHours) {
      const { error } = await supabase.from("shift_definition_day_hours" as any).upsert(
        {
          shift_definition_id: shiftId,
          day_of_week: row.day_of_week,
          start_time: hmToDb(row.start_time),
          end_time: row.end_time.trim() ? hmToDb(row.end_time) : null,
        },
        { onConflict: "shift_definition_id,day_of_week" },
      );
      if (error) {
        if (/shift_definition_day_hours|relation|schema cache/i.test(error.message ?? "")) {
          throw new Error("יש להריץ את migration שעות משמרות ב-Supabase לפני שמירת שעות לפי יום");
        }
        throw error;
      }
    }
    const { error: cleanupErr } = await supabase
      .from("shift_definition_day_hours" as any)
      .delete()
      .eq("shift_definition_id", shiftId)
      .not("day_of_week", "in", `(${allowedDows.join(",")})`);
    if (cleanupErr && !/shift_definition_day_hours|relation|schema cache/i.test(cleanupErr.message ?? "")) {
      throw cleanupErr;
    }
  }

  const saveMut = useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      start_time: string | null;
      end_time: string | null;
      color: string;
      is_active: boolean;
      dayHours: DayHourInput[];
      noTimes: boolean;
      periodDows: ScheduleDow[];
    }) => {
      const flatStart = input.noTimes ? null : input.start_time;
      const flatEnd = input.noTimes ? null : input.end_time;

      if (input.id) {
        const { error } = await supabase
          .from("shift_definitions")
          .update({
            name: input.name,
            start_time: flatStart,
            end_time: flatEnd,
            color: input.color,
            is_active: input.is_active,
          })
          .eq("id", input.id);
        if (error) throw error;
        await upsertDayHours(input.id, input.dayHours, !input.noTimes, input.periodDows);
      } else {
        const nextOrder = (rows[rows.length - 1]?.sort_order ?? 0) + 1;
        const code = slugifyCode(input.name);
        const existing = rows.find((r) => r.code === code);
        const finalCode = existing ? `${code}_${Date.now()}` : code;
        const { data: inserted, error } = await supabase
          .from("shift_definitions")
          .insert({
            code: finalCode,
            name: input.name,
            start_time: flatStart,
            end_time: flatEnd,
            color: input.color,
            sort_order: nextOrder,
            is_active: input.is_active,
            is_system: false,
            created_by: me!.id,
          })
          .select("id")
          .single();
        if (error) throw error;
        await upsertDayHours((inserted as any).id, input.dayHours, !input.noTimes, input.periodDows);
      }
    },
    onSuccess: () => {
      toast.success("נשמר — השינויים חלים מיד על סידורי העבודה");
      setEditing(null);
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["shift-definitions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const target = rows.find((r) => r.id === id);
      if (target) {
        const { count } = await supabase
          .from("schedule_shifts")
          .select("id", { count: "exact", head: true })
          .eq("shift", target.code);
        if ((count ?? 0) > 0) {
          throw new Error(
            `לא ניתן למחוק — המשמרת בשימוש ב-${count} שיבוצי עובדים. ניתן להשבית אותה במקום.`,
          );
        }
      }
      const { error } = await supabase.from("shift_definitions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("נמחק");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["shift-definitions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const reorderMut = useMutation({
    mutationFn: async (next: ShiftDef[]) => {
      for (let i = 0; i < next.length; i++) {
        const row = next[i];
        const newOrder = i + 1;
        if (row.sort_order === newOrder) continue;
        const { error } = await supabase
          .from("shift_definitions")
          .update({ sort_order: newOrder })
          .eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-definitions"] }),
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  function move(idx: number, dir: -1 | 1) {
    const arr = [...rows];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorderMut.mutate(arr);
  }

  if (!me) return null;
  const canManage = hasBranchActionPermission(
    me.roles,
    permissionsQ.data,
    "can_manage_schedule",
  );

  if (!canManage) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">
          אין הרשאה לגשת למסך זה. {supportContactInstruction(me.roles)}.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Clock className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">הגדרות משמרות</h1>
            <p className="text-sm text-muted-foreground mt-1">
              ניהול סוגי משמרות, שעות לפי יום ותקופת הסידור. השינויים חלים מיד על סידורי העבודה
              (מלבד תאים עם שעות ידניות).
            </p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" /> משמרת חדשה
            </Button>
          </DialogTrigger>
          <ShiftDialog
            key={createOpen ? "create" : "create-closed"}
            title="יצירת משמרת"
            dayNames={dayNames}
            periodDows={periodDows}
            saving={saveMut.isPending}
            onSubmit={(v) => saveMut.mutate({ ...v, periodDows })}
          />
        </Dialog>
      </header>

      <Card className="card-elevated p-4 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarRange className="size-5 text-primary" />
          <h2 className="font-semibold">תקופת סידור עבודה (סניף)</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>סוג תקופה</Label>
            <Select value={periodType} onValueChange={(v) => { markPeriodDirty(); setPeriodType(v as ScheduleType); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">שבועי</SelectItem>
                <SelectItem value="monthly">חודשי (מ-1 לחודש)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {periodType === "weekly" && (
            <>
              <div className="space-y-1.5">
                <Label>יום התחלת השבוע</Label>
                <Select value={weekStartDow} onValueChange={(v) => { markPeriodDirty(); setWeekStartDow(v); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dayNames.map((name, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>יום סיום השבוע</Label>
                <Select value={weekEndDow} onValueChange={(v) => { markPeriodDirty(); setWeekEndDow(v); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dayNames.map((name, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        {periodType === "monthly" && (
          <div className="space-y-2">
            <Label>ימי עבודה בחודש</Label>
            <p className="text-xs text-muted-foreground">
              סידור חודשי מתחיל ב-1 לכל חודש. סמנו אילו ימים בשבוע יופיעו בסידור — ימים שלא
              מסומנים (למשל שישי) לא יוצגו בכלל.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {dayNames.map((name, i) => {
                const dow = i as ScheduleDow;
                const checked = monthlyWorkingDows.includes(dow);
                return (
                  <label
                    key={i}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        markPeriodDirty();
                        setMonthlyWorkingDows((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(dow);
                          else next.delete(dow);
                          return normalizeMonthlyWorkingDows([...next]);
                        });
                      }}
                    />
                    <span className="text-sm">{name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <Button
          onClick={() => periodSaveMut.mutate()}
          disabled={periodSaveMut.isPending}
          className="gap-2"
        >
          {periodSaveMut.isPending && <Loader2 className="size-4 animate-spin" />}
          שמירת הגדרות תקופה
        </Button>
      </Card>

      {listQ.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">
          עדיין לא הוגדרו משמרות. לחצו על "משמרת חדשה" כדי להתחיל.
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((r, idx) => (
            <Card key={r.id} className="card-elevated p-4 flex items-center gap-3">
              <div
                className="size-9 rounded-full flex items-center justify-center font-semibold shrink-0 text-white"
                style={{ backgroundColor: r.color }}
              >
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate">{r.name}</p>
                  {r.is_system && (
                    <Badge variant="outline" className="gap-1">
                      <Lock className="size-3" /> מערכת
                    </Badge>
                  )}
                  {!r.is_active && <Badge variant="secondary">לא פעיל</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {summarizeShiftHours(r, listQ.dayHoursForShift(r.id), periodDows)}
                  {" · "}קוד: {r.code}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="העלאה למעלה"
                  disabled={idx === 0 || reorderMut.isPending}
                  onClick={() => move(idx, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="הורדה למטה"
                  disabled={idx === rows.length - 1 || reorderMut.isPending}
                  onClick={() => move(idx, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="עריכה" onClick={() => setEditing(r)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="מחיקה"
                  disabled={r.is_system}
                  title={r.is_system ? "לא ניתן למחוק משמרת מערכת" : undefined}
                  onClick={() => setDeleteTarget(r)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <ShiftDialog
            key={editing.id}
            title="עריכת משמרת"
            dayNames={dayNames}
            periodDows={periodDows}
            initial={editing}
            initialDayHours={listQ.dayHoursForShift(editing.id)}
            saving={saveMut.isPending}
            onSubmit={(v) => saveMut.mutate({ ...v, id: editing.id, periodDows })}
          />
        )}
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת משמרת</AlertDialogTitle>
            <AlertDialogDescription>
              האם למחוק את "{deleteTarget?.name}"? אם המשמרת בשימוש בסידור עבודה קיים — המחיקה תיחסם
              והמערכת תציע להשבית אותה במקום.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              disabled={deleteMut.isPending}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ShiftDialog({
  title,
  initial,
  initialDayHours,
  dayNames,
  periodDows,
  saving,
  onSubmit,
}: {
  title: string;
  dayNames: string[];
  periodDows: ScheduleDow[];
  initial?: Partial<ShiftDef>;
  initialDayHours?: Array<{ day_of_week: number; start_time: string | null; end_time: string | null }>;
  saving: boolean;
  onSubmit: (v: {
    name: string;
    start_time: string | null;
    end_time: string | null;
    color: string;
    is_active: boolean;
    dayHours: DayHourInput[];
    noTimes: boolean;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [noTimes, setNoTimes] = useState(!initial?.start_time && !initial?.end_time);

  const [dayHours, setDayHours] = useState<DayHourInput[]>(() =>
    buildDayHoursState(periodDows, initialDayHours, initial),
  );

  useEffect(() => {
    setDayHours(buildDayHoursState(periodDows, initialDayHours, initial));
  }, [periodDows.join(",")]);

  function setDayHour(idx: number, field: "start_time" | "end_time", value: string) {
    setDayHours((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }

  function applyToAllDays(start: string, end: string) {
    setDayHours((prev) => prev.map((row) => ({ ...row, start_time: start, end_time: end })));
  }

  function submit() {
    const n = name.trim();
    if (!n) {
      toast.error("יש להזין שם משמרת");
      return;
    }
    if (!noTimes) {
      for (const row of dayHours) {
        if (!row.start_time.trim()) {
          toast.error(`יש להזין שעת התחלה ליום ${dayNames[row.day_of_week]}`);
          return;
        }
      }
    }
    const first = dayHours[0];
    onSubmit({
      name: n,
      start_time: noTimes ? null : hmToDb(first?.start_time ?? ""),
      end_time: noTimes ? null : (first?.end_time.trim() ? hmToDb(first.end_time) : null),
      color,
      is_active: isActive,
      noTimes,
      dayHours: noTimes ? [] : dayHours,
    });
  }

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="sh-name">שם המשמרת</Label>
          <Input
            id="sh-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: בוקר, לילה, אמצע"
            autoComplete="off"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Switch id="sh-notimes" checked={noTimes} onCheckedChange={setNoTimes} />
          <Label htmlFor="sh-notimes" className="text-sm">
            ללא שעות (לדוגמה: חופש)
          </Label>
        </div>

        {!noTimes && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>שעות לפי יום</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyToAllDays(dayHours[0]?.start_time ?? "07:00", dayHours[0]?.end_time ?? "15:00")}
              >
                העתק {dayNames[periodDows[0] ?? 0]} לכל הימים
              </Button>
            </div>
            <div className="space-y-2 rounded-md border p-2">
              {dayHours.map((row, idx) => (
                <div key={row.day_of_week} className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 items-start">
                  <span className="text-xs font-medium truncate pt-2">{dayNames[row.day_of_week]}</span>
                  <Time24Input
                    aria-label={`התחלה ${dayNames[row.day_of_week]}`}
                    value={row.start_time}
                    onChange={(v) => setDayHour(idx, "start_time", v)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="space-y-0.5">
                    <Time24Input
                      aria-label={`סיום ${dayNames[row.day_of_week]} (אופציונלי)`}
                      value={row.end_time}
                      onChange={(v) => setDayHour(idx, "end_time", v)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-[10px] text-muted-foreground">סיום — אופציונלי</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>צבע המשמרת</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`צבע ${c}`}
                onClick={() => setColor(c)}
                className={`size-8 rounded-full border-2 transition ${
                  color === c ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="size-8 p-0 border-2 cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Switch id="sh-active" checked={isActive} onCheckedChange={setIsActive} />
          <Label htmlFor="sh-active" className="text-sm">
            פעיל (יוצג בסידורי עבודה)
          </Label>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving} className="gap-2">
          {saving && <Loader2 className="size-4 animate-spin" />} שמירה
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
