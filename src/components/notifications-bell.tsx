import { useEffect, useMemo } from "react";
import { Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatHeDateTime } from "@/lib/date-format";

interface Notification {
  id: string;
  schedule_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

export function NotificationsBell() {
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const userId = profile?.id;

  const { data: notifications } = useQuery({
    queryKey: ["schedule-notifications", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Notification[]> => {
      try {
        const { data, error } = await supabase
          .from("schedule_notifications")
          .select("id, schedule_id, message, read_at, created_at")
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) {
          console.warn("notifications fetch error", error);
          return [];
        }
        return (data ?? []) as Notification[];
      } catch (err) {
        console.warn("notifications fetch threw", err);
        return [];
      }
    },
    refetchInterval: 60_000,
  });

  // Realtime: new notifications for this user
  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`notif-${userId}-${Math.random().toString(36).slice(2, 8)}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "schedule_notifications",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            qc.invalidateQueries({ queryKey: ["schedule-notifications", userId] });
          },
        )
        .subscribe();
    } catch (err) {
      console.warn("notifications realtime subscribe failed", err);
    }
    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          /* noop */
        }
      }
    };
  }, [userId, qc]);

  const unreadCount = useMemo(
    () => (notifications ?? []).filter((n) => !n.read_at).length,
    [notifications],
  );

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const ids = (notifications ?? []).filter((n) => !n.read_at).map((n) => n.id);
      if (!ids.length) return;
      const { error } = await supabase
        .from("schedule_notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule-notifications", userId] });
    },
  });

  if (!userId) return null;

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
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">התראות</p>
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
        <div className="max-h-80 overflow-y-auto">
          {(notifications ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">אין התראות</p>
          ) : (
            <ul className="divide-y">
              {(notifications ?? []).map((n) => (
                <li key={n.id}>
                  <Link
                    to="/schedules"
                    className={cn(
                      "block px-3 py-2.5 text-sm hover:bg-accent transition-colors",
                      !n.read_at && "bg-primary/5",
                    )}
                  >
                    <p className={cn("leading-snug", !n.read_at && "font-medium")}>{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatHeDateTime(n.created_at)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
