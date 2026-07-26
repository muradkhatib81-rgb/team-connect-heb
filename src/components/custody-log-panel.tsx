import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/use-auth";
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

/** Daily equipment log table + filters (shared by page route). */
export function CustodyLogPanel({ branchId }: { branchId: string }) {
  const [search, setSearch] = useState("");
  const [empFilter, setEmpFilter] = useState("__all");
  const [itemFilter, setItemFilter] = useState("__all");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [durationTick, setDurationTick] = useState(() => Date.now());

  const { data: profile } = useAuth();
  const qc = useQueryClient();

  const capsQ = useQuery({
    enabled: !!profile,
    queryKey: ["custody-caps", profile?.id],
    queryFn: () => fetchCustodyUserCaps(profile!.id),
  });

  const logQ = useQuery({
    enabled: !!branchId && !!capsQ.data?.canAccessCustodyLog,
    queryKey: custodyLogQueryKey(branchId),
    queryFn: () => fetchCustodyDailyLog(branchId),
    staleTime: 0,
  });

  const returnMut = useMutation({
    mutationFn: (checkoutId: string) => returnCustodyItem(checkoutId, branchId),
    onSuccess: () => {
      toast.success("הציוד הוחזר");
      invalidateCustodyQueries(qc, branchId, profile?.id);
    },
    onError: (e: Error) => toast.error(e.message ?? "שגיאה בהחזרת ציוד"),
  });

  const log = logQ.data ?? [];
  const activeCount = log.filter((r) => r.status === "active").length;
  const canReturnOthers = !!capsQ.data?.canReturnOthers;

  useEffect(() => {
    if (activeCount === 0) return;
    const id = window.setInterval(() => setDurationTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [activeCount]);

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

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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

      <div className="min-h-[20rem] overflow-auto rounded-md border">
        {logQ.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {log.length === 0
              ? "אין רשומות ציוד להיום."
              : "לא נמצאו רשומות התואמות את הסינון."}
          </p>
        ) : (
          <table className="w-full text-xs sm:text-sm">
            <thead className="sticky top-0 bg-muted/40">
              <tr>
                <th className="p-2 text-right">👤 עובד</th>
                <th className="p-2 text-right">🏬 מחלקה</th>
                <th className="p-2 text-right">📦 ציוד</th>
                <th className="p-2 text-right">🕒 לקיחה</th>
                <th className="p-2 text-right">🕒 החזרה</th>
                <th className="p-2 text-right">⏱️ משך</th>
                <th className="p-2 text-right">📌 סטטוס</th>
                {canReturnOthers && <th className="p-2 text-right">⚙️ פעולות</th>}
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
                          className="h-8 gap-1"
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
    </div>
  );
}
