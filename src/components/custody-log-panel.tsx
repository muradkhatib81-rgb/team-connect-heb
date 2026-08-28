import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
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
  getCustodyLogBadgeLabel,
  getCustodyStatusLabel,
  invalidateCustodyQueries,
  returnCustodyItem,
} from "@/lib/custody-workflow";
import { announceCustodyChange } from "@/lib/management-on-shift.functions";

/** Daily equipment log table + filters (shared by page route). */
export function CustodyLogPanel({ branchId }: { branchId: string }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [empFilter, setEmpFilter] = useState("__all");
  const [itemFilter, setItemFilter] = useState("__all");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [durationTick, setDurationTick] = useState(() => Date.now());

  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const announceCustodyFn = useServerFn(announceCustodyChange);

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
    mutationFn: async ({
      checkoutId,
      itemName,
    }: {
      checkoutId: string;
      itemName: string;
    }) => {
      await returnCustodyItem(checkoutId, branchId);
      return itemName;
    },
    onSuccess: (itemName) => {
      toast.success(t("custody.returnSuccess"));
      void announceCustodyFn({ data: { action: "return", itemName } }).catch(() => {});
      invalidateCustodyQueries(qc, branchId, profile?.id);
    },
    onError: (e: Error) => toast.error(e.message ?? t("custody.returnError")),
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
          placeholder={t("custody.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={empFilter} onValueChange={setEmpFilter}>
          <SelectTrigger>
            <SelectValue placeholder={t("custody.filterEmployee")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("custody.allEmployees")}</SelectItem>
            {employees.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={itemFilter} onValueChange={setItemFilter}>
          <SelectTrigger>
            <SelectValue placeholder={t("custody.filterEquipment")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("custody.allEquipment")}</SelectItem>
            {items.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder={t("custody.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("custody.allStatuses")}</SelectItem>
            <SelectItem value="active">{getCustodyStatusLabel("active")}</SelectItem>
            <SelectItem value="returned">{getCustodyStatusLabel("returned")}</SelectItem>
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
              ? t("custody.noRecordsToday")
              : t("custody.noFilterMatch")}
          </p>
        ) : (
          <table className="w-full text-xs sm:text-sm">
            <thead className="sticky top-0 bg-muted/40">
              <tr>
                <th className="p-2 text-right">{t("custody.colEmployee")}</th>
                <th className="p-2 text-right">{t("custody.colDepartment")}</th>
                <th className="p-2 text-right">{t("custody.colEquipment")}</th>
                <th className="p-2 text-right">{t("custody.colCheckout")}</th>
                <th className="p-2 text-right">{t("custody.colReturn")}</th>
                <th className="p-2 text-right">{t("custody.colDuration")}</th>
                <th className="p-2 text-right">{t("custody.colStatus")}</th>
                {canReturnOthers && <th className="p-2 text-right">{t("custody.colActions")}</th>}
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
                        {getCustodyLogBadgeLabel("active")}
                      </Badge>
                    ) : r.spansMidnight ? (
                      <Badge variant="outline" className="border-orange-400 text-orange-700">
                        {getCustodyLogBadgeLabel("spansMidnight")}
                      </Badge>
                    ) : r.returnType === "manager" ? (
                      <Badge className="bg-blue-600 text-white hover:bg-blue-600">
                        {getCustodyLogBadgeLabel("managerReturn")}
                      </Badge>
                    ) : (
                      <Badge className="bg-green-600 text-white hover:bg-green-600">
                        {getCustodyLogBadgeLabel("returned")}
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
                          onClick={() =>
                            returnMut.mutate({ checkoutId: r.id, itemName: r.itemName })
                          }
                        >
                          <RotateCcw className="size-3.5" />
                          {t("custody.return")}
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
