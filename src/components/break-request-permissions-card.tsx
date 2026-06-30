import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useJobTitles, type JobTitleRow } from "@/lib/use-job-titles";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export function BreakRequestPermissionsCard() {
  const qc = useQueryClient();
  const titlesQ = useJobTitles();

  useEffect(() => {
    const ch = supabase
      .channel("break-perm-job-titles")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_titles" },
        () => qc.invalidateQueries({ queryKey: ["job-titles"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const mut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from("job_titles" as any)
        .update({ can_request_break: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-titles"] });
      qc.invalidateQueries({ queryKey: ["my-can-request-break"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בעדכון ההרשאה"),
  });

  const titles = (titlesQ.data ?? []) as JobTitleRow[];

  return (
    <Card className="p-5 space-y-4">
      <header className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <KeyRound className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">הרשאות בקשת הפסקה</h2>
          <p className="text-sm text-muted-foreground mt-1">
            קביעה לכל תפקיד האם בעלי התפקיד רשאים לשלוח בקשת הפסקה. כאשר מבוטל,
            כפתור "בקשת הפסקה" יוסתר עבורם והם לא יוכלו להגיש בקשה.
          </p>
        </div>
      </header>

      {titlesQ.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : titles.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          אין עדיין תפקידים במערכת.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {titles.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 p-3 bg-card"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t.can_request_break ? "רשאי לבקש הפסקה" : "לא רשאי לבקש הפסקה"}
                </div>
              </div>
              <Switch
                checked={!!t.can_request_break}
                disabled={mut.isPending}
                onCheckedChange={(value) => mut.mutate({ id: t.id, value })}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
