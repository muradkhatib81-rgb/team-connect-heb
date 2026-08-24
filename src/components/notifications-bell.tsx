import { useMemo } from "react";
import { Bell, CalendarDays, MessageSquare } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatHeDateTime } from "@/lib/date-format";
import { markMessageRead } from "@/lib/communications.functions";
import i18n from "@/i18n";
import { notificationLinkTarget } from "@/lib/notification-navigation";

type Kind = "schedule" | "message";

interface UnifiedItem {
  id: string;
  kind: Kind;
  title: string;
  created_at: string;
  read: boolean;
  to: string;
  search?: Record<string, any>;
  refId: string; // scheduleNotifId | messageId
}

export function NotificationsBell() {
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const userId = profile?.id;

  // System notifications (schedules, breaks, employee of month, etc.)
  const schedQ = useQuery({
    queryKey: ["notif", "schedule", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from("schedule_notifications")
          .select("id, schedule_id, message, read_at, created_at, schedule:schedules(week_start)")
          .is("read_at", null)
          .order("created_at", { ascending: false })
          .limit(30);
        return data ?? [];
      } catch {
        return [];
      }
    },
  });

  // Unread messages directed at the user
  const msgQ = useQuery({
    queryKey: ["notif", "messages", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("message_recipients")
        .select(
          "message_id, delivered_at, read_at, message:messages!inner(id, title, created_at, deleted_at)",
        )
        .eq("user_id", userId!)
        .is("read_at", null)
        .is("archived_at", null)
        .order("delivered_at", { ascending: false })
        .limit(30);
      return ((data ?? []) as any[]).filter((r) => !r.message?.deleted_at);
    },
  });

  // Realtime invalidations handled by global RealtimeBridge in app-shell.

  const items: UnifiedItem[] = useMemo(() => {
    const out: UnifiedItem[] = [];
    (schedQ.data ?? []).forEach((n: any) => {
      const weekStart = n.schedule?.week_start ?? null;
      const link = notificationLinkTarget(n.message, {
        scheduleId: n.schedule_id,
        weekStart,
      });
      out.push({
        id: `s-${n.id}`,
        kind: "schedule",
        title: n.message,
        created_at: n.created_at,
        read: !!n.read_at,
        to: link.to,
        search: link.search,
        refId: n.id,
      });
    });
    (msgQ.data ?? []).forEach((r: any) =>
      out.push({
        id: `m-${r.message_id}`,
        kind: "message",
        title: r.message?.title ?? "הודעה",
        created_at: r.delivered_at ?? r.message?.created_at,
        read: false,
        to: "/communications",
        search: { tab: "inbox", msg: r.message_id },
        refId: r.message_id,
      }),
    );
    return out
      .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))
      .slice(0, 30);
  }, [schedQ.data, msgQ.data]);

  const markOneRead = async (n: UnifiedItem) => {
    if (!userId) return;
    qc.setQueryData(["notif", "schedule", userId], (old: unknown) => {
      if (n.kind !== "schedule" || !Array.isArray(old)) return old;
      return old.filter((row: { id: string }) => row.id !== n.refId);
    });
    qc.setQueryData(["notif", "messages", userId], (old: unknown) => {
      if (n.kind !== "message" || !Array.isArray(old)) return old;
      return old.filter((row: { message_id: string }) => row.message_id !== n.refId);
    });
    try {
      if (n.kind === "schedule") {
        await supabase
          .from("schedule_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", n.refId);
      } else {
        await markMessageRead(n.refId);
      }
    } finally {
      qc.invalidateQueries({ queryKey: ["notif"] });
      qc.invalidateQueries({ queryKey: ["shell-comm-unread"] });
    }
  };

  const unreadCount = items.filter((i) => !i.read).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const now = new Date().toISOString();
      const schedIds = (schedQ.data ?? []).filter((n: { read_at?: string | null }) => !n.read_at).map((n: { id: string }) => n.id);
      const msgIds = (msgQ.data ?? []).map((r: { message_id: string }) => r.message_id);
      const jobs: Promise<unknown>[] = [];
      if (schedIds.length) {
        jobs.push(
          supabase.from("schedule_notifications").update({ read_at: now }).in("id", schedIds),
        );
      }
      if (msgIds.length) {
        jobs.push(
          supabase
            .from("message_recipients")
            .update({ read_at: now })
            .eq("user_id", userId)
            .in("message_id", msgIds)
            .is("read_at", null),
        );
      }
      if (jobs.length) await Promise.all(jobs);
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notif"] });
      const prevSched = qc.getQueryData(["notif", "schedule", userId]);
      const prevMsg = qc.getQueryData(["notif", "messages", userId]);
      const prevUnread = qc.getQueryData(["shell-comm-unread", userId]);
      qc.setQueryData(["notif", "schedule", userId], []);
      qc.setQueryData(["notif", "messages", userId], []);
      qc.setQueryData(["shell-comm-unread", userId], 0);
      return { prevSched, prevMsg, prevUnread };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData(["notif", "schedule", userId], ctx.prevSched);
      qc.setQueryData(["notif", "messages", userId], ctx.prevMsg);
      qc.setQueryData(["shell-comm-unread", userId], ctx.prevUnread);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["notif"] });
      qc.invalidateQueries({ queryKey: ["shell-comm-unread"] });
      qc.invalidateQueries({ queryKey: ["communications"] });
    },
  });

  if (!userId) return null;

  const iconFor = (k: Kind) => (k === "message" ? MessageSquare : CalendarDays);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={i18n.t("common.notifications")}>
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">{i18n.t("dashboard.notifCenter")}</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="text-xs text-primary hover:underline"
            >
              {i18n.t("dashboard.markAllRead")}
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{i18n.t("dashboard.noNewNotifs")}</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = iconFor(n.kind);
                return (
                  <li key={n.id}>
                    <Link
                      to={n.to}
                      search={n.search as any}
                      onClick={() => {
                        void markOneRead(n);
                      }}
                      className={cn(
                        "flex items-start gap-2 px-3 py-2.5 text-sm hover:bg-accent transition-colors cursor-pointer",
                        !n.read && "bg-primary/5",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 mt-0.5 shrink-0",
                          n.kind === "message" && "text-blue-600",
                          n.kind === "schedule" && "text-primary",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn("leading-snug truncate", !n.read && "font-medium")}>
                          {n.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatHeDateTime(n.created_at)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
