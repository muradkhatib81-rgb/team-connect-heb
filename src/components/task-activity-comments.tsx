import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { listTaskActivity, listTaskComments, addTaskComment } from "@/lib/tasks.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatHeDateTime } from "@/lib/date-format";
import { Loader2, History, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { BilingualContent } from "@/components/bilingual-content";
import { pickBilingualResult, useBilingualContentMap } from "@/lib/use-bilingual-content";

const TASK_STATUS_KEYS: Record<string, string> = {
  new: "tasks.statusNew",
  in_progress: "tasks.statusInProgress",
  pending_approval: "tasks.statusPendingApproval",
  pending_closure: "tasks.statusPendingClosure",
  completed: "tasks.statusCompleted",
  closed: "tasks.statusClosed",
};

export function TaskActivityComments({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const activityFn = useServerFn(listTaskActivity);
  const commentsFn = useServerFn(listTaskComments);
  const addCommentFn = useServerFn(addTaskComment);

  const activityKey = ["task-activity", taskId];
  const commentsKey = ["task-comments", taskId];

  const activity = useQuery({
    queryKey: activityKey,
    queryFn: async () => (await activityFn({ data: { task_id: taskId } })) as any[],
  });
  const comments = useQuery({
    queryKey: commentsKey,
    queryFn: async () => (await commentsFn({ data: { task_id: taskId } })) as any[],
  });

  const commentBilingualItems = useMemo(
    () =>
      (comments.data ?? [])
        .filter((c: any) => c.body?.trim() && c.author_id)
        .map((c: any) => ({
          key: `${c.id}-body`,
          entityType: "task_comment" as const,
          entityId: c.id,
          field: "body" as const,
          text: c.body as string,
          authorId: c.author_id as string,
        })),
    [comments.data],
  );

  const { map: commentBilingualMap, isLoading: commentBilingualLoading } = useBilingualContentMap(
    commentBilingualItems,
    (comments.data?.length ?? 0) > 0,
  );

  useEffect(() => {
    const ch = supabase
      .channel(`task-feed-${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_activity_log", filter: `task_id=eq.${taskId}` },
        () => qc.invalidateQueries({ queryKey: activityKey }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` },
        () => qc.invalidateQueries({ queryKey: commentsKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [taskId]);

  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: async () => addCommentFn({ data: { task_id: taskId, body: body.trim() } }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: commentsKey });
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.error")),
  });

  const eventLabel = (event: string) => {
    const key = `taskActivity.events.${event}`;
    const translated = t(key);
    return translated !== key ? translated : event;
  };

  const statusLabel = (status: string) => {
    const key = TASK_STATUS_KEYS[status];
    return key ? t(key) : status;
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 px-3 py-2 border-b text-sm font-medium">
          <History className="size-4" /> {t("taskActivity.activityTitle")}
        </header>
        <div className="max-h-56 overflow-y-auto p-3 space-y-2 text-sm">
          {activity.isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : !activity.data?.length ? (
            <p className="text-muted-foreground text-xs">{t("taskActivity.noActivity")}</p>
          ) : (
            activity.data.map((row: any) => {
              const from = row.payload?.from ? statusLabel(row.payload.from) : null;
              const to = row.payload?.to ? statusLabel(row.payload.to) : null;
              return (
                <div key={row.id} className="flex gap-2 items-start">
                  <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[110px]">
                    {formatHeDateTime(row.created_at)}
                  </span>
                  <span className="flex-1">
                    {row.actor_name ? (
                      <b>{row.actor_name}</b>
                    ) : (
                      <span className="text-muted-foreground">{t("taskActivity.system")}</span>
                    )}
                    {" — "}
                    {eventLabel(row.event)}
                    {from && to ? `: ${from} → ${to}` : ""}
                    {row.payload?.note ? ` — "${row.payload.note}"` : ""}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 px-3 py-2 border-b text-sm font-medium">
          <MessageSquare className="size-4" /> {t("taskActivity.commentsTitle")}
        </header>
        <div className="max-h-56 overflow-y-auto p-3 space-y-2 text-sm">
          {comments.isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : !comments.data?.length ? (
            <p className="text-muted-foreground text-xs">{t("taskActivity.noComments")}</p>
          ) : (
            comments.data.map((c: any) => (
              <div key={c.id} className="rounded-md bg-muted/50 p-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <b className="text-foreground">{c.author_name}</b>
                  <span>{formatHeDateTime(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap mt-1">
                  <BilingualContent
                    text={c.body}
                    result={pickBilingualResult(commentBilingualMap, `${c.id}-body`, c.body)}
                    loading={commentBilingualLoading}
                  />
                </p>
              </div>
            ))
          )}
        </div>
        <div className="p-3 border-t flex gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder={t("taskActivity.commentPlaceholder")}
          />
          <Button
            onClick={() => add.mutate()}
            disabled={!body.trim() || add.isPending}
            size="sm"
          >
            {add.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
            {t("taskActivity.send")}
          </Button>
        </div>
      </section>
    </div>
  );
}
