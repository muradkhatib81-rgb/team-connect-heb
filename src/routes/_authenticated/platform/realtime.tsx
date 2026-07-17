import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Lock, Pencil, Plus, Radio, Trash2, Users, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlatformContext } from "@/platform";
import type { ChannelSnapshot, ChannelVisibility } from "@/core";

export const Route = createFileRoute("/_authenticated/platform/realtime")({
  component: PlatformRealtimePage,
});

const CHANNELS_QUERY_KEY = ["platform-realtime-channels"] as const;

const VISIBILITY_LABELS: Record<ChannelVisibility, string> = {
  public: "ציבורי",
  private: "פרטי",
  system: "מערכת",
};

function VisibilityBadge({ visibility }: { visibility: ChannelVisibility }) {
  if (visibility === "system") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Zap className="size-3" />
        מערכת
      </Badge>
    );
  }
  if (visibility === "private") {
    return (
      <Badge variant="outline" className="gap-1">
        <Lock className="size-3" />
        פרטי
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Eye className="size-3" />
      ציבורי
    </Badge>
  );
}

function PlatformRealtimePage() {
  const { runtime } = usePlatformContext();
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [editChannel, setEditChannel] = useState<ChannelSnapshot | null>(null);
  const [deleteChannel, setDeleteChannel] = useState<ChannelSnapshot | null>(null);

  const channelsQuery = useQuery({
    queryKey: CHANNELS_QUERY_KEY,
    queryFn: () => runtime.listRealtimeChannels(),
    refetchInterval: 5000,
  });

  const closeMut = useMutation({
    mutationFn: async (name: string) => runtime.closeRealtimeChannel(name),
    onSuccess: () => {
      toast.success("הערוץ נסגר");
      qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message ?? "הפעולה נכשלה"),
  });

  const reopenMut = useMutation({
    mutationFn: async (channel: ChannelSnapshot) =>
      runtime.openRealtimeChannel({
        name: channel.name,
        description: channel.description,
        visibility: channel.visibility,
      }),
    onSuccess: () => {
      toast.success("הערוץ נפתח מחדש");
      qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message ?? "הפעולה נכשלה"),
  });

  const publishMut = useMutation({
    mutationFn: async (name: string) =>
      runtime.publishRealtimeEvent(name, { type: "platform.test-event", sentAt: new Date().toISOString() }),
    onSuccess: () => {
      toast.success("אירוע בדיקה נשלח");
      qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message ?? "הפעולה נכשלה"),
  });

  const channels = channelsQuery.data ?? [];
  const openCount = channels.filter((c) => !c.closedAt).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Radio className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">ניהול Real-Time</h1>
            <p className="text-sm text-muted-foreground mt-1">
              ערוצי Real-Time בהיקף הפלטפורמה — דרך ה-Realtime Manager הקיים. ללא ספק Realtime
              חיצוני מחובר.
            </p>
          </div>
        </div>
        <Button onClick={() => setOpenCreate(true)} className="gap-2">
          <Plus className="size-4" />
          פתיחת ערוץ
        </Button>
      </header>

      <Card className="card-elevated overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            ערוצים ({channels.length}) · פתוחים: {openCount}
          </h2>
        </div>
        {channelsQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            <Loader2 className="size-5 animate-spin text-primary mx-auto" />
          </div>
        ) : channels.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין ערוצים עדיין בסשן הנוכחי. ניתן לפתוח ערוץ חדש מהכפתור מעלה.
          </div>
        ) : (
          <ul className="divide-y">
            {channels.map((channel) => (
              <li key={channel.name} className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="font-mono" dir="ltr">
                        {channel.name}
                      </Badge>
                      <VisibilityBadge visibility={channel.visibility} />
                      {channel.closedAt ? (
                        <Badge variant="secondary" className="gap-1">
                          <EyeOff className="size-3" />
                          סגור
                        </Badge>
                      ) : (
                        <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
                          פתוח
                        </Badge>
                      )}
                    </div>
                    {channel.description && (
                      <p className="text-sm text-muted-foreground">{channel.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      title="עריכה"
                      onClick={() => setEditChannel(channel)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                      {!channel.closedAt && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="שליחת אירוע בדיקה"
                          onClick={() => publishMut.mutate(channel.name)}
                          disabled={publishMut.isPending}
                        >
                          <Zap className="size-4" />
                        </Button>
                      )}
                    {channel.closedAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reopenMut.mutate(channel)}
                        disabled={reopenMut.isPending}
                      >
                        פתיחה מחדש
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => closeMut.mutate(channel.name)}
                        disabled={closeMut.isPending}
                      >
                        סגירה
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      title="מחיקה"
                      onClick={() => setDeleteChannel(channel)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <StatBox icon={Users} label="לקוחות מחוברים" value={channel.connectedClients} />
                  <StatBox icon={Radio} label="מנויים פעילים" value={channel.activeSubscriptions} />
                  <StatBox icon={Zap} label="אירועים פעילים" value={channel.eventsPublished} />
                  <StatBox
                    icon={Loader2}
                    label="פעילות אחרונה"
                    value={
                      channel.lastActivityAt
                        ? channel.lastActivityAt.toLocaleTimeString("he-IL")
                        : "—"
                    }
                    hideSpin
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ChannelFormDialog open={openCreate} onOpenChange={setOpenCreate} />

      {editChannel && (
        <ChannelFormDialog
          open={!!editChannel}
          onOpenChange={(v) => !v && setEditChannel(null)}
          channel={editChannel}
        />
      )}

      {deleteChannel && (
        <AlertDialog open onOpenChange={(v) => !v && setDeleteChannel(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>מחיקת ערוץ</AlertDialogTitle>
              <AlertDialogDescription>
                האם למחוק את הערוץ &quot;{deleteChannel.name}&quot;? הפעולה תסיר את כל המנויים
                הפעילים ואת היסטוריית האירועים של הערוץ.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  runtime.deleteRealtimeChannel(deleteChannel.name);
                  toast.success("הערוץ נמחק");
                  qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
                  setDeleteChannel(null);
                }}
              >
                מחיקה
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  hideSpin,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  hideSpin?: boolean;
}) {
  return (
    <div className="rounded-lg border p-2 space-y-1">
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        {!hideSpin && <Icon className="size-3" />}
        <span>{label}</span>
      </div>
      <p className="font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ChannelFormDialog({
  open,
  onOpenChange,
  channel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel?: ChannelSnapshot;
}) {
  const { runtime } = usePlatformContext();
  const qc = useQueryClient();
  const isEdit = !!channel;
  const [name, setName] = useState(channel?.name ?? "");
  const [description, setDescription] = useState(channel?.description ?? "");
  const [visibility, setVisibility] = useState<ChannelVisibility>(channel?.visibility ?? "public");

  const mut = useMutation({
    mutationFn: async () => {
      if (isEdit && channel) {
        return runtime.updateRealtimeChannel(channel.name, {
          description: description.trim(),
          visibility,
        });
      }
      return runtime.openRealtimeChannel({
        name: name.trim(),
        description: description.trim(),
        visibility,
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "הערוץ עודכן" : "הערוץ נפתח");
      qc.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
      onOpenChange(false);
      if (!isEdit) {
        setName("");
        setDescription("");
        setVisibility("public");
      }
    },
    onError: (e: Error) => toast.error(e.message ?? "הפעולה נכשלה"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `עריכת ערוץ — ${channel?.name}` : "פתיחת ערוץ חדש"}</DialogTitle>
          <DialogDescription>
            ערוץ Real-Time בהיקף הפלטפורמה, מנוהל ונשמר דרך ה-Realtime Manager הקיים לאורך הסשן
            הנוכחי.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
          className="space-y-3"
        >
          {!isEdit && (
            <div className="space-y-1">
              <Label htmlFor="channel-name">שם הערוץ *</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="platform-events"
                dir="ltr"
                required
                autoFocus
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="channel-description">תיאור (אופציונלי)</Label>
            <Textarea
              id="channel-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label>חשיפה</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as ChannelVisibility)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{VISIBILITY_LABELS.public}</SelectItem>
                <SelectItem value="private">{VISIBILITY_LABELS.private}</SelectItem>
                <SelectItem value="system">{VISIBILITY_LABELS.system}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={mut.isPending || (!isEdit && !name.trim())}
              className="gap-2"
            >
              {mut.isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "שמירה" : "פתיחת ערוץ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
