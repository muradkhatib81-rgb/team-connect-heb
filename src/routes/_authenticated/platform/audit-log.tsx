import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, Search, Loader2 } from "lucide-react";
import {
  usePlatformOwnersQuery,
  usePlatformAuditQuery,
  PLATFORM_EVENT_LABELS,
} from "@/lib/platform-owners.hooks";

export const Route = createFileRoute("/_authenticated/platform/audit-log")({
  component: PlatformAuditLogPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? "שגיאה"}
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">הדף לא נמצא</div>
  ),
});

function PlatformAuditLogPage() {
  const owners = usePlatformOwnersQuery();
  const audit = usePlatformAuditQuery();

  const [q, setQ] = useState("");
  const [event, setEvent] = useState<string>("all");

  const ownerName = (id: string | null) =>
    (id && owners.data?.find((o) => o.user_id === id)?.full_name) || null;

  const rows = useMemo(() => {
    const all = audit.data ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((e) => {
      if (event !== "all" && e.event !== event) return false;
      if (needle) {
        const actor = ownerName(e.actor_id)?.toLowerCase() ?? "";
        const target = ownerName(e.target_user_id)?.toLowerCase() ?? "";
        if (!actor.includes(needle) && !target.includes(needle)) return false;
      }
      return true;
    });
  }, [audit.data, owners.data, q, event]);

  const eventOptions = Object.keys(PLATFORM_EVENT_LABELS);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <ShieldCheck className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">יומן פעילות פלטפורמה</h1>
          <p className="text-sm text-muted-foreground mt-1">כל פעולות בעלי המערכת מתועדות כאן</p>
        </div>
      </header>

      <Card className="card-elevated p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="חיפוש לפי מבצע או יעד…"
              className="pr-9"
            />
          </div>
          <Select value={event} onValueChange={setEvent}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל האירועים</SelectItem>
              {eventOptions.map((e) => (
                <SelectItem key={e} value={e}>{PLATFORM_EVENT_LABELS[e]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="card-elevated overflow-hidden">
        {audit.isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין רשומות תואמות
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-right p-3 font-medium">תאריך</th>
                  <th className="text-right p-3 font-medium">אירוע</th>
                  <th className="text-right p-3 font-medium">מבצע</th>
                  <th className="text-right p-3 font-medium">יעד</th>
                  <th className="text-right p-3 font-medium hidden md:table-cell">פרטים</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-accent/30 align-top">
                    <td className="p-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString("he-IL")}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline">{PLATFORM_EVENT_LABELS[e.event] ?? e.event}</Badge>
                    </td>
                    <td className="p-3">{ownerName(e.actor_id) ?? "—"}</td>
                    <td className="p-3">{ownerName(e.target_user_id) ?? "—"}</td>
                    <td className="p-3 hidden md:table-cell text-xs text-muted-foreground">
                      {e.payload && Object.keys(e.payload as object).length > 0 ? (
                        <code className="whitespace-pre-wrap break-all">
                          {JSON.stringify(e.payload)}
                        </code>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
