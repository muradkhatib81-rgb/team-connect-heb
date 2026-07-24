import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Package, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { CustodySettingsPanel } from "@/components/custody-settings-panel";
import { useQuery } from "@tanstack/react-query";
import { fetchCustodyUserCaps } from "@/lib/custody-workflow";
import { supportContactInstruction } from "@/lib/constants";

export const Route = createFileRoute("/_authenticated/custody-settings")({
  component: CustodySettingsPage,
});

function CustodySettingsPage() {
  const { data: me } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const branchId = activeBranchId ?? me?.branch_id ?? null;

  const capsQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["custody-caps", me?.id],
    queryFn: () => fetchCustodyUserCaps(me!.id),
  });

  if (!me) return null;

  if (!branchId) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">לא נמצא סניף</h2>
        <p className="text-sm text-muted-foreground mt-2">יש לבחור סניף פעיל.</p>
      </Card>
    );
  }

  if (capsQ.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!capsQ.data?.canOpenSettings) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">
          נדרשת הרשאה מ«מערכת ניהול ציוד». {supportContactInstruction(me.roles)}.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
          <Package className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">מערכת ניהול ציוד</h1>
          <p className="text-sm text-muted-foreground">הגדרות פריטי ציוד והתראות</p>
        </div>
      </header>

      <Card className="card-elevated p-6">
        <CustodySettingsPanel branchId={branchId} userId={me.id} compact />
      </Card>
    </div>
  );
}
