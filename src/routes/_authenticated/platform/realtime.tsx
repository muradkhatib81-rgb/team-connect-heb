import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Radio, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePlatformContext } from "@/platform";

export const Route = createFileRoute("/_authenticated/platform/realtime")({
  component: PlatformRealtimePage,
});

const CHANNELS_QUERY_KEY = ["platform-realtime-channels"] as const;

function PlatformRealtimePage() {
  const { runtime } = usePlatformContext();
  const qc = useQueryClient();
  const [channelName, setChannelName] = useState("");

  const channelsQuery = useQuery({
    queryKey: CHANNELS_QUERY_KEY,
    queryFn: () => runtime.listRealtimeChannels(),
  });

  const openMut = useMutation({
    mutationFn: async (name: string) => runtime.openRealtimeChannel(name),
    onSuccess: () => {
      toast.success("הערוץ נפתח");
      qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
      setChannelName("");
    },
  });

  const channels = channelsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Radio className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">ניהול Real-Time</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ערוצי Real-Time בהיקף הפלטפורמה — דרך ה-Realtime Manager הקיים. ללא ספק Realtime חיצוני
            מחובר.
          </p>
        </div>
      </header>

      <Card className="card-elevated p-4">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = channelName.trim();
            if (!trimmed) return;
            openMut.mutate(trimmed);
          }}
        >
          <Input
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder="שם ערוץ, לדוגמה: platform-events"
            className="max-w-xs"
            dir="ltr"
          />
          <Button type="submit" size="sm" className="gap-2" disabled={openMut.isPending}>
            <Plus className="size-4" />
            פתיחת ערוץ
          </Button>
        </form>
      </Card>

      <Card className="card-elevated overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground">
            ערוצים פתוחים ({channels.length})
          </h2>
        </div>
        {channelsQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">טוען…</div>
        ) : channels.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין ערוצים פתוחים עדיין בסשן הנוכחי
          </div>
        ) : (
          <ul className="divide-y">
            {channels.map((name) => (
              <li key={name} className="flex items-center gap-3 p-3">
                <Badge variant="outline" className="font-mono" dir="ltr">
                  {name}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
