import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { DEPARTMENT_LABELS, DEPARTMENT_OPTIONS, isAdmin } from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { Loader2, Building2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/departments")({
  component: DepartmentsPage,
});

function DepartmentsPage() {
  const { data: me } = useAuth();
  const allowed = me ? isAdmin(me.roles) : false;

  const query = useQuery({
    enabled: allowed,
    queryKey: ["departments-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("department, is_active");
      if (error) throw error;
      const counts: Record<string, { total: number; active: number }> = {};
      DEPARTMENT_OPTIONS.forEach((d) => (counts[d] = { total: 0, active: 0 }));
      data.forEach((r) => {
        const c = counts[r.department];
        c.total += 1;
        if (r.is_active) c.active += 1;
      });
      return counts;
    },
  });

  if (!allowed) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold">מחלקות הסניף</h1>
        <p className="text-sm text-muted-foreground mt-1">סקירת המחלקות וכמות העובדים בכל אחת</p>
      </header>

      {query.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DEPARTMENT_OPTIONS.map((d) => {
            const c = query.data?.[d] ?? { total: 0, active: 0 };
            return (
              <Card key={d} className="card-elevated p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">מחלקה</p>
                    <h2 className="text-lg font-semibold mt-1">{DEPARTMENT_LABELS[d]}</h2>
                  </div>
                  <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Building2 className="size-5" />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Stat label="סך עובדים" value={c.total} />
                  <Stat label="פעילים" value={c.active} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );
}
