import { useEffect, useMemo } from "react";
import { Bell, CalendarDays, Mail, Megaphone } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatHeDateTime } from "@/lib/date-format";

type Kind = "schedule" | "message" | "announcement";

interface UnifiedItem {
  id: string;
  kind: Kind;
  title: string;
  created_at: string;
  read: boolean;
  to: string;
  // origin ids for mark-read
  scheduleNotifId?: string;
  messageId?: string;
  announcementId?: string;
}

export function NotificationsBell() {
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const userId = profile?.id;

  // Schedule notifications (existing table)
  const schedQ = useQuery({
    queryKey: ["notif", "schedule", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from("schedule_notifications")
          .select("id, schedule_id, message, read_at, created_at")
          .order("created_at", { ascending: false })
          .limit(20);
        return data ?? [];
      } catch {
        return [];
      }
    },
  });

  // Unread incoming messages
  const msgQ = useQuery({
    queryKey: ["notif", "messages", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
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
        .limit(20);
      return ((data ?? []) as any[]).filter((r) => !r.message?.deleted_at);
    },
  });

  // Active announcements
  const annQ = useQuery({
    queryKey: ["notif", "announcements", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data: anns } = await supabase
        .from("announcements")
        .select("id, title, starts_at, ends_at, created_at")
        .is("deleted_at", null)
        .lte("starts_at", nowIso)
        .order("starts_at", { ascending: false })
        .limit(20);
      const rows = ((anns ?? []) as any[]).filter((a) => !a.ends_at || a.ends_at > nowIso);
      if (!rows.length) return [];
      const { data: reads } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .in("announcement_id", rows.map((r) => r.id))
        .eq("user_id", userId!);
      const readSet = new Set((reads ?? []).map((r: any) => r.announcement_id));
      return rows.map((r) => ({ ...r, read: readSet.has(r.id) }));
    },
  });

  // Realtime invalidations
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`bell-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_notifications", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["notif", "schedule", userId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_recipients", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["notif", "messages", userId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "announcements" },
        () => qc.invalidateQueries({ queryKey: ["notif", "announcements", userId] }),
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {
        /* noop */
      }
    };
  }, [userId, qc]);

  const items: UnifiedItem[] = useMemo(() => {
    const out: UnifiedItem[] = [];
    (schedQ.data ?? []).forEach((n: any) =>
      out.push({
        id: `s-${n.id}`,
        kind: "schedule",
        title: n.message,
        created_at: n.created_at,
        read: !!n.read_at,
        to: "/schedules",
        scheduleNotifId: n.id,
      }),
    );
    (msgQ.data ?? []).forEach((r: any) =>
      out.push({
        id: `m-${r.message_id}`,
        kind: "message",
        title: `הודעה חדשה: ${r.message.title}`,
        created_at: r.delivered_at ?? r.message.created_at,
        read: false,
        to: "/communications",
        messageId: r.message_id,
      }),
    );
    (annQ.data ?? []).forEach((a: any) => {
      if (a.read) return;
      out.push({
        id: `a-${a.id}`,
        kind: "announcement",
        title: `הכרזה: ${a.title}`,
        created_at: a.starts_at ?? a.created_at,
        read: false,
        to: "/communications",
        announcementId: a.id,
      });
    });
    return out
      .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at))
      .slice(0, 30);
  }, [schedQ.data, msgQ.data, annQ.data]);

  const unreadCount = items.filter((i) => !i.read).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      // schedule notifs
      const schedIds = (schedQ.data ?? []).filter((n: any) => !n.read_at).map((n: any) => n.id);
      if (schedIds.length) {
        await supabase
          .from("schedule_notifications")
          .update({ read_at: new Date().toISOString() })
          .in("id", schedIds);
      }
      // messages
      const msgIds = (msgQ.data ?? []).map((r: any) => r.message_id);
      if (msgIds.length) {
        await supabase
          .from("message_recipients")
          .update({ read_at: new Date().toISOString() })
          .in("message_id", msgIds)
          .eq("user_id", userId);
      }
      // announcements
      const annIds = (annQ.data ?? []).filter((a: any) => !a.read).map((a: any) => a.id);
      if (annIds.length) {
        const rows = annIds.map((aid: string) => ({
          announcement_id: aid,
          user_id: userId,
          read_at: new Date().toISOString(),
        }));
        await supabase
          .from("announcement_reads")
          .upsert(rows, { onConflict: "announcement_id,user_id" });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif"] });
      qc.invalidateQueries({ queryKey: ["shell-comm-unread"] });
    },
  });

  if (!userId) return null;

  const iconFor = (k: Kind) =>
    k === "schedule" ? CalendarDays : k === "message" ? Mail : Megaphone;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="התראות">
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" dir="rtl">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">מרכז התראות</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="text-xs text-primary hover:underline"
            >
              סמן הכל כנקרא
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">אין התראות חדשות</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = iconFor(n.kind);
                return (
                  <li key={n.id}>
                    <Link
                      to={n.to}
                      className={cn(
                        "flex items-start gap-2 px-3 py-2.5 text-sm hover:bg-accent transition-colors",
                        !n.read && "bg-primary/5",
                      )}
                    >
                      <Icon className="size-4 mt-0.5 text-primary shrink-0" />
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
