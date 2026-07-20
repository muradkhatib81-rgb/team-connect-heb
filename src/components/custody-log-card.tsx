import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ClipboardList, ChevronLeft, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { toast } from "sonner";
import {
  custodyDurationMinutes,
  custodyLogQueryKey,
  custodyTimeHM,
  fetchCustodyDailyLog,
  fetchCustodyUserCaps,
  fmtCustodyDuration,
  invalidateCustodyQueries,
  returnCustodyItem,
} from "@/lib/custody-workflow";

type CustodyLogCardProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CustodyLogCard({ open: openProp, onOpenChange }: CustodyLogCardProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [search, setSearch] = useState("");
  const [empFilter, setEmpFilter] = useState("__all");
  const [itemFilter, setItemFilter] = useState("__all");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [durationTick, setDurationTick] = useState(() => Date.now());

  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;

  const capsQ = useQuery({
    enabled: !!profile,
    queryKey: ["custody-caps", profile?.id],
    queryFn: () => fetchCustodyUserCaps(profile!.id),
  });

  const logQ = useQuery({
    enabled: !!scopedBranchId && !!capsQ.data?.canAccessCustodyLog,
    queryKey: custodyLogQueryKey(scopedBranchId),
    queryFn: () => fetchCustodyDailyLog(scopedBranchId!),
    staleTime: 0,
  });

  const returnMut = useMutation({
    mutationFn: (checkoutId: string) => {
      if (!scopedBranchId) throw new Error("לא נמצא סניף");
      return returnCustodyItem(checkoutId, scopedBranchId);
    },
    onSuccess: () => {
      toast.success("הציוד הוחזר");
      invalidateCustodyQueries(qc, scopedBranchId, profile?.id);
    },
    onError: (e: Error) => toast.error(e.message ?? "שגיאה בהחזרת ציוד"),
  });

  const log = logQ.data ?? [];
  const activeCount = log.filter((r) => r.status === "active").length;
  const canReturnOthers = !!capsQ.data?.canReturnOthers;

  useEffect(() => {
    if (!open || activeCount === 0) return;
    const id = window.setInterval(() => setDurationTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [open, activeCount]);

  const filtered = useMemo(() => {
    return log.filter((r) => {
      if (empFilter !== "__all" && r.userName !== empFilter) return false;
      if (itemFilter !== "__all" && r.itemName !== itemFilter) return false;
      if (statusFilter !== "__all" && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [r.userName, r.itemName, r.departmentName, r.returnActorName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [log, empFilter, itemFilter, statusFilter, search]);

  const employees = useMemo(
    () => Array.from(new Set(log.map((r) => r.userName))).sort((a, b) => a.localeCompare(b, "he")),
    [log],
  );
  const items = useMemo(
    () => Array.from(new Set(log.map((r) => r.itemName))).sort((a, b) => a.localeCompare(b, "he")),
    [log],
  );

  if (!profile || capsQ.isLoading) return null;
  if (!capsQ.data?.canAccessCustodyLog || !scopedBranchId) return null;

  const todayLabel = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "full",
    numberingSystem: "latn",
    calendar: "gregory",
  }).format(new Date());

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-right group"
      >
        <Card className="p-5 border-teal-500/25 bg-gradient-to-br from-teal-500/5 via-background to-background shadow-soft cursor-pointer transition-all hover:border-teal-500/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-teal-500/15 text-teal-600 flex items-center justify-center shrink-0">
                <ClipboardList className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-bold leading-tight">📋 יומן ניהול ציוד</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {logQ.isLoading
                    ? "טוען רשומות..."
                    : log.length === 0
                      ? "אין רשומות היום — לחץ לצפייה"
                      : `${log.length} רשומות היום${activeCount > 0 ? ` · ${activeCount} בשימוש` : ""}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-teal-600">
              {!logQ.isLoading && log.length > 0 && (
                <span className="text-2xl font-bold tabular-nums">{log.length}</span>
              )}
              <ChevronLeft className="size-5 opacity-60 group-hover:opacity-100 group-hover:-translate-x-0.5 transition-all" />
            </div>
          </div>
        </Card>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <ClipboardList className="size-5 text-teal-600" />
              📋 יומן ניהול ציוד
              <span className="text-xs font-normal text-muted-foreground">{todayLabel}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
            <Input
              placeholder="🔎 חיפוש..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={empFilter} onValueChange={setEmpFilter}>
              <SelectTrigger>
                <SelectValue placeholder="עובד" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">כל העובדים</SelectItem>
                {employees.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger>
                <SelectValue placeholder="ציוד" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">כל הציוד</SelectItem>
                {items.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="סטטוס" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">כל הסטטוסים</SelectItem>
                <SelectItem value="active">בשימוש</SelectItem>
                <SelectItem value="returned">הוחזר</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-auto flex-1 border rounded-md min-h-0 mt-3">
            {logQ.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-8 text-sm text-muted-foreground text-center">
                {log.length === 0
                  ? "אין רשומות ציוד להיום."
                  : "לא נמצאו רשומות התואמות את הסינון."}
              </p>
            ) : (
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-right p-2">👤 עובד</th>
                    <th className="text-right p-2">🏬 מחלקה</th>
                    <th className="text-right p-2">📦 ציוד</th>
                    <th className="text-right p-2">🕒 לקיחה</th>
                    <th className="text-right p-2">🕒 החזרה</th>
                    <th className="text-right p-2">⏱️ משך</th>
                    <th className="text-right p-2">📌 סטטוס</th>
                    {canReturnOthers && <th className="text-right p-2">⚙️ פעולות</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-border/50 hover:bg-muted/20">
                      <td className="p-2 font-medium">{r.userName}</td>
                      <td className="p-2 text-muted-foreground">{r.departmentName ?? "—"}</td>
                      <td className="p-2">{r.itemName}</td>
                      <td className="p-2 tabular-nums">{custodyTimeHM(r.checkedOutAt)}</td>
                      <td className="p-2 tabular-nums">
                        {r.returnedAt ? custodyTimeHM(r.returnedAt) : "—"}
                      </td>
                      <td className="p-2">
                        {r.status === "active"
                          ? fmtCustodyDuration(custodyDurationMinutes(r.checkedOutAt, durationTick))
                          : fmtCustodyDuration(r.durationMinutes)}
                      </td>
                      <td className="p-2">
                        {r.status === "active" ? (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                            🟡 בשימוש
                          </Badge>
                        ) : r.spansMidnight ? (
                          <Badge variant="outline" className="border-orange-400 text-orange-700">
                            🌙 חצה חצות
                          </Badge>
                        ) : r.returnType === "manager" ? (
                          <Badge className="bg-blue-600 text-white hover:bg-blue-600">
                            🔵 החזרת מנהל
                          </Badge>
                        ) : (
                          <Badge className="bg-green-600 text-white hover:bg-green-600">
                            🟢 הוחזר
                          </Badge>
                        )}
                      </td>
                      {canReturnOthers && (
                        <td className="p-2">
                          {r.status === "active" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1 h-8"
                              disabled={returnMut.isPending}
                              onClick={() => returnMut.mutate(r.id)}
                            >
                              <RotateCcw className="size-3.5" />
                              החזר
                            </Button>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
