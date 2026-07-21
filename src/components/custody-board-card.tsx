import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Package, RotateCcw, Hand, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { toast } from "sonner";
import {
  checkoutCustodyItem,
  custodyQueryKey,
  custodyTimeHM,
  custodyVisibleQueryKey,
  fetchCustodyBoard,
  fetchCustodyBoardVisible,
  fetchCustodyUserCaps,
  invalidateCustodyQueries,
  returnCustodyItem,
} from "@/lib/custody-workflow";
import { CustodySettingsPanel } from "@/components/custody-settings-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";

export function CustodyBoardCard() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;

  const visibleQ = useQuery({
    enabled: !!profile && !!scopedBranchId,
    queryKey: custodyVisibleQueryKey(profile?.id ?? null, scopedBranchId),
    queryFn: () => fetchCustodyBoardVisible(scopedBranchId),
    staleTime: 30_000,
  });

  const capsQ = useQuery({
    enabled: !!profile,
    queryKey: ["custody-caps", profile?.id],
    queryFn: () => fetchCustodyUserCaps(profile!.id),
  });

  const boardQ = useQuery({
    enabled: !!profile && !!scopedBranchId && visibleQ.data === true,
    queryKey: custodyQueryKey(scopedBranchId),
    queryFn: () => fetchCustodyBoard(scopedBranchId!),
  });

  useEffect(() => {
    if (!profile || !scopedBranchId) return;
    const ch = supabase
      .channel(`custody-${profile.id}-${scopedBranchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "custody_checkouts",
          filter: `branch_id=eq.${scopedBranchId}`,
        },
        () => invalidateCustodyQueries(qc, scopedBranchId, profile.id),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "custody_item_types",
          filter: `branch_id=eq.${scopedBranchId}`,
        },
        () => invalidateCustodyQueries(qc, scopedBranchId, profile.id),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "management_on_shift",
          filter: `branch_id=eq.${scopedBranchId}`,
        },
        () => qc.invalidateQueries({ queryKey: custodyVisibleQueryKey(profile.id, scopedBranchId) }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_shifts" },
        () => qc.invalidateQueries({ queryKey: custodyVisibleQueryKey(profile.id, scopedBranchId) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.id, scopedBranchId, qc]);

  const checkoutMut = useMutation({
    mutationFn: (itemTypeId: string) => {
      if (!scopedBranchId) throw new Error("לא נמצא סניף");
      return checkoutCustodyItem(itemTypeId, scopedBranchId);
    },
    onSuccess: () => {
      toast.success("הציוד נלקח בהצלחה");
      invalidateCustodyQueries(qc, scopedBranchId, profile?.id);
    },
    onError: (e: Error) => toast.error(e.message ?? "שגיאה בלקיחת ציוד"),
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

  const myActiveIds = useMemo(() => {
    if (!profile || !boardQ.data) return new Set<string>();
    return new Set(
      boardQ.data
        .filter((s) => s.checkout?.user_id === profile.id)
        .map((s) => s.checkout!.id),
    );
  }, [boardQ.data, profile]);

  const caps = capsQ.data;

  if (!profile || visibleQ.isLoading) return null;

  if (profile.on_leave) return null;

  if (visibleQ.data !== true) {
    if (caps?.canOpenSettings && scopedBranchId) {
      return (
        <Card className="p-5 border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-background to-background shadow-soft">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
                <Package className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-bold leading-tight">📦 מערכת ניהול ציוד</h2>
                <p className="text-xs text-muted-foreground">
                  לוח הציוד זמין במהלך משמרת — ניתן להגדיר פריטים מראש
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-2" asChild>
              <Link to="/custody-settings">
                <Settings2 className="size-4" />
                הגדרות
              </Link>
            </Button>
          </div>
        </Card>
      );
    }
    return null;
  }

  const slots = boardQ.data ?? [];
  const busy = checkoutMut.isPending || returnMut.isPending;

  return (
    <Card className="p-5 border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-background to-background shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
            <Package className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-bold leading-tight">📦 מערכת ניהול ציוד</h2>
            <p className="text-xs text-muted-foreground">
              לחץ על ציוד פנוי (ירוק) ללקיחה — אדום = בשימוש
            </p>
          </div>
        </div>
        {caps?.canOpenSettings && scopedBranchId && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-4" />
              הגדרות
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link to="/custody-settings">מסך מלא</Link>
            </Button>
          </div>
        )}
      </div>

      {scopedBranchId && (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>הגדרות מערכת ניהול ציוד</DialogTitle>
            </DialogHeader>
            <CustodySettingsPanel branchId={scopedBranchId} userId={profile.id} compact />
          </DialogContent>
        </Dialog>
      )}

      {boardQ.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : slots.length === 0 ? (
        <div className="text-center py-6 space-y-2">
          <p className="text-sm text-muted-foreground">אין ציוד מוגדר לסניף זה</p>
          {caps?.canCreate && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
              הגדר ציוד ראשון
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {slots.map((slot) => {
            const taken = !!slot.checkout;
            const isMine = slot.checkout?.user_id === profile.id;
            const canReturn = taken && (isMine || !!caps?.canReturnOthers);
            const canTake = !taken;

            return (
              <button
                key={slot.id}
                type="button"
                disabled={busy || (!canTake && !canReturn)}
                onClick={() => {
                  if (canTake) checkoutMut.mutate(slot.id);
                  else if (canReturn && slot.checkout) returnMut.mutate(slot.checkout.id);
                }}
                className={[
                  "rounded-xl border-2 p-4 text-right transition-all min-h-[7.5rem]",
                  "flex flex-col justify-between gap-2",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  taken
                    ? "border-red-400/60 bg-red-500/10 hover:bg-red-500/15"
                    : "border-emerald-400/60 bg-emerald-500/10 hover:bg-emerald-500/20",
                  !canTake && !canReturn ? "opacity-70 cursor-default" : "cursor-pointer",
                ].join(" ")}
              >
                <div className="flex flex-1 items-center justify-center text-center px-1">
                  <span className="font-bold text-2xl sm:text-3xl leading-tight break-words">
                    {slot.name}
                  </span>
                </div>
                {taken && slot.checkout ? (
                  <div className="text-xs space-y-0.5 text-red-900/80 dark:text-red-100/90 shrink-0">
                    <div className="text-lg sm:text-xl font-bold leading-tight">
                      {slot.checkout.full_name ?? "—"}
                    </div>
                    {slot.checkout.department_name && (
                      <div className="text-muted-foreground">{slot.checkout.department_name}</div>
                    )}
                    <div className="text-muted-foreground">
                      מ-{custodyTimeHM(slot.checkout.checked_out_at)}
                    </div>
                    {canReturn && (
                      <div className="flex items-center gap-1 mt-2 text-primary font-medium">
                        {isMine ? (
                          <>
                            <RotateCcw className="size-3.5" />
                            החזר
                          </>
                        ) : (
                          <>
                            <Hand className="size-3.5" />
                            החזר (מנהל)
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-center gap-1 shrink-0">
                    <Hand className="size-3.5" />
                    פנוי — לחץ ללקיחה
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {myActiveIds.size > 0 && (
        <p className="text-xs text-muted-foreground mt-4">
          מחזיק/ה {myActiveIds.size} פריט/י ציוד — יש להחזיר בסיום
        </p>
      )}
    </Card>
  );
}
