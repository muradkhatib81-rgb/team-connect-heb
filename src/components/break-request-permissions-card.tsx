import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useJobTitles, type JobTitleRow } from "@/lib/use-job-titles";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function BreakRequestPermissionsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const titlesQ = useJobTitles();

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
      qc.invalidateQueries({ queryKey: ["can-request-break"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("breakRequestPermissions.updateError")),
  });

  const titles = (titlesQ.data ?? []) as JobTitleRow[];

  return (
    <Card className="p-5 space-y-4">
      <header className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <KeyRound className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t("breakRequestPermissions.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("breakRequestPermissions.description")}
          </p>
        </div>
      </header>

      {titlesQ.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : titles.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          {t("breakRequestPermissions.noJobTitles")}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {titles.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 p-3 bg-card"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{row.name}</div>
                <div className="text-xs text-muted-foreground">
                  {row.can_request_break
                    ? t("breakRequestPermissions.canRequest")
                    : t("breakRequestPermissions.cannotRequest")}
                </div>
              </div>
              <Switch
                checked={!!row.can_request_break}
                disabled={mut.isPending}
                onCheckedChange={(value) => mut.mutate({ id: row.id, value })}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
