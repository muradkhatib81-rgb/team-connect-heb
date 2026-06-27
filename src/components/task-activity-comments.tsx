import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTaskActivity, listTaskComments, addTaskComment } from "@/lib/tasks.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatHeDateTime } from "@/lib/date-format";
import { Loader2, History, MessageSquare } from "lucide-react";
import { toast } from "sonner";

const EVENT_LABELS: Record<string, string> = {
  created: "המשימה נוצרה",
  status_changed: "שינוי סטטוס",
  assignees_changed: "עדכון מבצעים",
  departments_changed: "עדכון מחלקות",
  image_added: "הועלתה תמונה",
  image_removed: "תמונה הוסרה",
  comment_added: "הערה חדשה",
  approved: "המשימה אושרה",
  returned: "המשימה הוחזרה לביצוע",
  closed: "המשימה נסגרה",
};

const STATUS_LABELS: Record<string, string> = {
  new: "חדש",
  in_progress: "בביצוע",
  pending_approval: "ממתינה לאישור",
  pending_closure: "ממתינה לסגירה",
  completed: "הושלמה",
  closed: "סגורה",
};

export function TaskActivityComments({ taskId }: { taskId: string }) {
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
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 px-3 py-2 border-b text-sm font-medium">
          <History className="size-4" /> היסטוריית פעילות
        </header>
        <div className="max-h-56 overflow-y-auto p-3 space-y-2 text-sm">
          {activity.isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : !activity.data?.length ? (
            <p className="text-muted-foreground text-xs">אין רישומים עדיין</p>
          ) : (
            activity.data.map((row: any) => {
              const from = row.payload?.from ? STATUS_LABELS[row.payload.from] ?? row.payload.from : null;
              const to = row.payload?.to ? STATUS_LABELS[row.payload.to] ?? row.payload.to : null;
              return (
                <div key={row.id} className="flex gap-2 items-start">
                  <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[110px]">
                    {formatHeDateTime(row.created_at)}
                  </span>
                  <span className="flex-1">
                    {row.actor_name ? <b>{row.actor_name}</b> : <span className="text-muted-foreground">מערכת</span>}
                    {" — "}
                    {EVENT_LABELS[row.event] ?? row.event}
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
          <MessageSquare className="size-4" /> הערות
        </header>
        <div className="max-h-56 overflow-y-auto p-3 space-y-2 text-sm">
          {comments.isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : !comments.data?.length ? (
            <p className="text-muted-foreground text-xs">אין הערות עדיין</p>
          ) : (
            comments.data.map((c: any) => (
              <div key={c.id} className="rounded-md bg-muted/50 p-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <b className="text-foreground">{c.author_name}</b>
                  <span>{formatHeDateTime(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap mt-1">{c.body}</p>
              </div>
            ))
          )}
        </div>
        <div className="p-3 border-t flex gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="כתוב הערה…"
          />
          <Button
            onClick={() => add.mutate()}
            disabled={!body.trim() || add.isPending}
            size="sm"
          >
            {add.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
            שלח
          </Button>
        </div>
      </section>
    </div>
  );
}
