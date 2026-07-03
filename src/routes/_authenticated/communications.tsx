import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { isAdmin } from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Inbox,
  Send,
  Megaphone,
  Archive,
  PenSquare,
  CheckCheck,
  Trash2,
  RotateCcw,
  Search,
  Paperclip,
  AlertCircle,
  Loader2,
  Eye,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { formatHeDateTime } from "@/lib/date-format";
import {
  sendMessage,
  markMessageRead,
  acknowledgeMessage,
  archiveMessage,
  deleteMessage,
  getAttachmentUrl,
  editMessage,
  permanentDeleteMessage,
  type CommPriority,
} from "@/lib/communications.functions";
import { cn } from "@/lib/utils";
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
import { CommSenderHeader } from "@/components/comm-sender-header";

type CommSearch = {
  tab?: "inbox" | "sent" | "archive";
  msg?: string;
};

export const Route = createFileRoute("/_authenticated/communications")({
  component: CommunicationsPage,
  validateSearch: (s: Record<string, unknown>): CommSearch => {
    const tab = s.tab as string | undefined;
    return {
      tab: tab === "inbox" || tab === "sent" || tab === "archive" ? tab : undefined,
      msg: typeof s.msg === "string" ? s.msg : undefined,
    };
  },
});

// ---------------- Shared helpers ----------------
const PRIORITY_LABEL: Record<CommPriority, string> = {
  low: "נמוכה",
  normal: "רגילה",
  high: "גבוהה",
  urgent: "דחופה",
};
const PRIORITY_CLASS: Record<CommPriority, string> = {
  low: "bg-muted text-foreground",
  normal: "bg-sky-100 text-sky-900",
  high: "bg-amber-100 text-amber-900",
  urgent: "bg-red-100 text-red-900",
};

function PriorityBadge({ p }: { p: CommPriority }) {
  return <Badge className={cn("border-0", PRIORITY_CLASS[p])}>{PRIORITY_LABEL[p]}</Badge>;
}

interface PermsRow {
  can_view_messages: boolean | null;
  can_send_messages: boolean | null;
  can_send_message_employee: boolean | null;
  can_send_message_department: boolean | null;
  can_send_message_all: boolean | null;
  can_manage_communications: boolean | null;
  can_delete_communications: boolean | null;
  can_view_read_receipts: boolean | null;
}

function CommunicationsPage() {
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const userId = me?.id;
  const admin = me ? isAdmin(me.roles) : false;
  const isDeptManager = !!me?.roles.includes("department_manager");

  // Granular perms
  const permsQ = useQuery({
    enabled: !!userId,
    queryKey: ["comm-perms", userId],
    queryFn: async (): Promise<PermsRow> => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select(
          "can_view_messages, can_send_messages, can_send_message_employee, can_send_message_department, can_send_message_all, can_manage_communications, can_delete_communications, can_view_read_receipts",
        )
        .eq("user_id", userId!)
        .maybeSingle();
      return (data as PermsRow) ?? ({} as PermsRow);
    },
  });
  const p = permsQ.data ?? ({} as PermsRow);
  // Department managers behave like regular employees in communications:
  // read-only inbox/archive. All send/edit/delete/receipts capabilities
  // are forcibly disabled unless they are also an admin.
  const deptMgrOnly = isDeptManager && !admin;
  const canSendMsg = !deptMgrOnly && (admin || !!p.can_send_messages || !!p.can_manage_communications);
  const canManage = !deptMgrOnly && (admin || !!p.can_manage_communications);
  const canDelete = !deptMgrOnly && (admin || !!p.can_delete_communications || !!p.can_manage_communications);
  const canViewReceipts = !deptMgrOnly && (admin || !!p.can_view_read_receipts || !!p.can_manage_communications);
  const canSeeSent = canSendMsg || canManage;

  // Realtime subscriptions (messages only — announcements module removed)
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`comms-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => qc.invalidateQueries({ queryKey: ["comm"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_recipients", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["comm"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);

  const search = Route.useSearch();
  const navigate = useNavigate();
  const initialTab: "inbox" | "sent" | "archive" =
    search.tab ?? (search.msg ? "inbox" : "inbox");
  const [tab, setTab] = useState<string>(initialTab);
  const [composeOpen, setComposeOpen] = useState(false);

  // React to incoming search params (e.g. clicking a different notification while page is open)
  useEffect(() => {
    if (search.tab) setTab(search.tab);
    else if (search.msg) setTab("inbox");
  }, [search.tab, search.msg]);

  // Clears the deep-link search params (used after a dialog is closed)
  const clearDeepLink = () => {
    if (search.msg || search.tab) {
      navigate({
        to: "/communications",
        search: {},
        replace: true,
      });
    }
  };

  if (!me) return null;

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="size-6 text-primary" /> מרכז תקשורת
          </h1>
          <p className="text-sm text-muted-foreground">הודעות פנימיות וארכיון</p>
        </div>
        <div className="flex gap-2">
          {canSendMsg && (
            <Button onClick={() => setComposeOpen(true)} className="gap-2">
              <PenSquare className="size-4" /> הודעה חדשה
            </Button>
          )}
        </div>
      </header>

      <Tabs value={canSeeSent ? tab : tab === "sent" ? "inbox" : tab} onValueChange={setTab}>
        <TabsList className={`grid ${canSeeSent ? "grid-cols-3" : "grid-cols-2"} w-full`}>
          <TabsTrigger value="inbox" className="gap-1.5">
            <Inbox className="size-4" /> דואר נכנס
          </TabsTrigger>
          {canSeeSent && (
            <TabsTrigger value="sent" className="gap-1.5">
              <Send className="size-4" /> שנשלחו
            </TabsTrigger>
          )}
          <TabsTrigger value="archive" className="gap-1.5">
            <Archive className="size-4" /> ארכיון
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <InboxTab
            userId={userId!}
            canDelete={canDelete}
            initialMessageId={search.msg ?? null}
            onClearDeepLink={clearDeepLink}
          />
        </TabsContent>
        {canSeeSent && (
          <TabsContent value="sent" className="mt-4">
            <SentTab userId={userId!} canManage={canManage} canDelete={canDelete} canViewReceipts={canViewReceipts} />
          </TabsContent>
        )}
        <TabsContent value="archive" className="mt-4">
          <ArchiveTab userId={userId!} canDelete={canDelete} />
        </TabsContent>
      </Tabs>

      {composeOpen && (
        <ComposeMessageDialog
          open={composeOpen}
          onOpenChange={setComposeOpen}
          perms={p}
          admin={admin}
          isDeptManager={isDeptManager}
          myDeptId={me.department_id}
        />
      )}
    </div>
  );
}

// ---------------- Inbox ----------------
interface InboxRow {
  message_id: string;
  read_at: string | null;
  acknowledged_at: string | null;
  archived_at: string | null;
  delivered_at: string | null;
  message: {
    id: string;
    title: string;
    body: string;
    priority: CommPriority;
    requires_acknowledgment: boolean;
    sender_id: string;
    created_at: string;
    deleted_at: string | null;
    edited_at?: string | null;
  };
  sender?: { full_name: string | null } | null;
}

function InboxTab({
  userId,
  canDelete,
  initialMessageId,
  onClearDeepLink,
}: {
  userId: string;
  canDelete: boolean;
  initialMessageId?: string | null;
  onClearDeepLink?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "important">("all");
  const [selected, setSelected] = useState<string | null>(initialMessageId ?? null);

  useEffect(() => {
    if (initialMessageId) setSelected(initialMessageId);
  }, [initialMessageId]);

  const q = useQuery({
    queryKey: ["comm", "inbox", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_recipients")
        .select(
          "message_id, read_at, acknowledged_at, archived_at, delivered_at, message:messages!inner(id,title,body,priority,requires_acknowledgment,sender_id,created_at,deleted_at,edited_at)",
        )
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("delivered_at", { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as any[]).filter(
        (r) => !r.message?.deleted_at && r.message?.sender_id !== userId,
      );
      const senderIds = [...new Set(rows.map((r) => r.message.sender_id).filter(Boolean))];
      let senderMap: Record<string, string> = {};
      if (senderIds.length) {
        const { data: sp } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", senderIds);
        (sp ?? []).forEach((u: any) => (senderMap[u.id] = u.full_name));
      }
      return rows.map((r) => ({ ...r, sender: { full_name: senderMap[r.message.sender_id] ?? "—" } })) as InboxRow[];
    },
  });

  const filtered = useMemo(() => {
    const list = q.data ?? [];
    return list.filter((r) => {
      if (filter === "unread" && r.read_at) return false;
      if (filter === "important" && r.message.priority !== "high" && r.message.priority !== "urgent")
        return false;
      if (search) {
        const t = search.trim().toLowerCase();
        if (!r.message.title.toLowerCase().includes(t) && !r.message.body.toLowerCase().includes(t))
          return false;
      }
      return true;
    });
  }, [q.data, filter, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="חיפוש..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">הכל</SelectItem>
            <SelectItem value="unread">לא נקראו</SelectItem>
            <SelectItem value="important">חשובות/דחופות</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {q.isLoading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">אין הודעות להצגה</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Card
              key={r.message_id}
              onClick={() => setSelected(r.message_id)}
              className={cn(
                "p-3 cursor-pointer hover:bg-accent/50 transition-colors flex items-start gap-3",
                !r.read_at && "border-r-4 border-r-primary bg-primary/5",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={cn("text-sm truncate", !r.read_at && "font-bold")}>
                    {r.message.title}
                  </p>
                  <PriorityBadge p={r.message.priority} />
                  {r.message.requires_acknowledgment && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <AlertCircle className="size-3" /> נדרש אישור
                    </Badge>
                  )}
                  {r.acknowledged_at && (
                    <Badge className="bg-emerald-100 text-emerald-900 border-0 gap-1 text-xs">
                      <CheckCheck className="size-3" /> אושר
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {r.sender?.full_name} · {formatHeDateTime(r.delivered_at ?? r.message.created_at)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <MessageDetailDialog
          messageId={selected}
          onClose={() => {
            setSelected(null);
            onClearDeepLink?.();
          }}
          viewerMode="inbox"
          canDelete={canDelete}
        />
      )}
    </div>
  );
}

// ---------------- Sent ----------------
function SentTab({
  userId,
  canManage,
  canDelete,
  canViewReceipts,
}: {
  userId: string;
  canManage: boolean;
  canDelete: boolean;
  canViewReceipts: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["comm", "sent", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, title, body, priority, requires_acknowledgment, created_at, deleted_at, edited_at, edited_by")
        .eq("sender_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (data ?? []).map((m: any) => m.id);
      let statsMap: Record<string, { total: number; read: number; ack: number }> = {};
      if (ids.length) {
        const { data: recs } = await supabase
          .from("message_recipients")
          .select("message_id, read_at, acknowledged_at")
          .in("message_id", ids);
        (recs ?? []).forEach((r: any) => {
          const s = (statsMap[r.message_id] ||= { total: 0, read: 0, ack: 0 });
          s.total++;
          if (r.read_at) s.read++;
          if (r.acknowledged_at) s.ack++;
        });
      }
      return (data ?? []).map((m: any) => ({ ...m, stats: statsMap[m.id] ?? { total: 0, read: 0, ack: 0 } }));
    },
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
          <Send className="size-4" /> הודעות שנשלחו
        </h3>
        {q.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : (q.data ?? []).length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">לא שלחת הודעות עדיין</Card>
        ) : (
          (q.data ?? []).map((m: any) => {
            const pct = m.stats.total ? Math.round((m.stats.read / m.stats.total) * 100) : 0;
            return (
              <Card
                key={m.id}
                onClick={() => setSelected(m.id)}
                className="p-3 cursor-pointer hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{m.title}</p>
                      <PriorityBadge p={m.priority} />
                      {m.edited_at && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Pencil className="size-3" /> נערך
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      נשלח {formatHeDateTime(m.created_at)}
                      {m.edited_at && ` · עודכן ${formatHeDateTime(m.edited_at)}`}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground text-left">
                    <div>{m.stats.read}/{m.stats.total} קראו ({pct}%)</div>
                    {m.requires_acknowledgment && <div>{m.stats.ack}/{m.stats.total} אישרו</div>}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </section>

      {selected && (
        <MessageDetailDialog
          messageId={selected}
          onClose={() => setSelected(null)}
          viewerMode="sent"
          canManage={canManage}
          canDelete={canDelete}
          canViewReceipts={canViewReceipts}
        />
      )}
    </div>
  );
}

// ---------------- Archive ----------------
function ArchiveTab({ userId, canDelete }: { userId: string; canDelete: boolean }) {
  const qc = useQueryClient();

  const msgsQ = useQuery({
    queryKey: ["comm", "archive-msgs", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_recipients")
        .select(
          "message_id, archived_at, message:messages!inner(id,title,body,priority,created_at,deleted_at)",
        )
        .eq("user_id", userId)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const restoreMsg = useMutation({
    mutationFn: (id: string) => archiveMessage(id, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comm"] }),
  });
  const delMsg = useMutation({
    mutationFn: (id: string) => deleteMessage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comm"] }),
  });

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold mb-2 text-muted-foreground">הודעות בארכיון</h3>
        {(msgsQ.data ?? []).length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">ריק</Card>
        ) : (
          <div className="space-y-2">
            {(msgsQ.data ?? []).map((r: any) => (
              <Card key={r.message_id} className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.message.title}</p>
                  <p className="text-xs text-muted-foreground">
                    בוטל ב-{formatHeDateTime(r.archived_at)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => restoreMsg.mutate(r.message_id)}
                    className="gap-1.5"
                  >
                    <RotateCcw className="size-4" /> שחזר
                  </Button>
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive gap-1.5"
                      onClick={() => {
                        if (confirm("למחוק לצמיתות?")) delMsg.mutate(r.message_id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------- Message Detail Dialog ----------------
function MessageDetailDialog({
  messageId,
  onClose,
  viewerMode,
  canManage,
  canDelete,
  canViewReceipts,
}: {
  messageId: string;
  onClose: () => void;
  viewerMode: "inbox" | "sent";
  canManage?: boolean;
  canDelete?: boolean;
  canViewReceipts?: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["comm", "msg-detail", messageId],
    queryFn: async () => {
      const { data: m, error } = await supabase
        .from("messages")
        .select(
          "id, title, body, priority, requires_acknowledgment, sender_id, created_at, edited_at, edited_by, edit_count, deleted_at",
        )
        .eq("id", messageId)
        .maybeSingle();
      if (error) throw error;
      if (!m) return { missing: true } as any;
      const { data: sender } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", m.sender_id)
        .maybeSingle();
      let editor_name: string | null = null;
      if (m.edited_by) {
        const { data: ed } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", m.edited_by)
          .maybeSingle();
        editor_name = ed?.full_name ?? null;
      }
      const { data: atts } = await supabase
        .from("message_attachments")
        .select("id, file_name, storage_path, mime_type, file_size")
        .eq("message_id", messageId);
      let recipients: any[] = [];
      if (viewerMode === "sent") {
        const { data: recs } = await supabase
          .from("message_recipients")
          .select("user_id, read_at, acknowledged_at, profile:profiles!inner(full_name, departments(name))")
          .eq("message_id", messageId);
        recipients = recs ?? [];
      }
      return {
        msg: m,
        sender_name: sender?.full_name ?? "—",
        editor_name,
        atts: atts ?? [],
        recipients,
        missing: !!m.deleted_at,
      };
    },
  });

  useEffect(() => {
    if (viewerMode !== "inbox") return;
    if (!q.data || q.data.missing) return;
    markMessageRead(messageId)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["comm"] });
        qc.invalidateQueries({ queryKey: ["notif"] });
        qc.invalidateQueries({ queryKey: ["shell-comm-unread"] });
      })
      .catch(() => {});
  }, [messageId, viewerMode, qc, q.data]);

  const ackMut = useMutation({
    mutationFn: () => acknowledgeMessage(messageId),
    onSuccess: () => {
      toast.success("האישור נשמר");
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });
  const archMut = useMutation({
    mutationFn: () => archiveMessage(messageId, true),
    onSuccess: () => {
      toast.success("הועבר לארכיון");
      qc.invalidateQueries({ queryKey: ["comm"] });
      onClose();
    },
  });
  const permDelMut = useMutation({
    mutationFn: () => permanentDeleteMessage(messageId),
    onSuccess: () => {
      toast.success("נמחק לצמיתות");
      qc.invalidateQueries({ queryKey: ["comm"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);

  const d = q.data;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        {q.isLoading || !d ? (
          <Loader2 className="mx-auto size-5 animate-spin" />
        ) : d.missing ? (
          <>
            <DialogHeader>
              <DialogTitle>הפריט אינו קיים עוד.</DialogTitle>
              <DialogDescription>
                הודעה זו נמחקה או אינה זמינה. ההתראה הישנה הוסרה מהמערכת.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>סגור</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {d.msg.title}
                <PriorityBadge p={d.msg.priority} />
                {d.msg.requires_acknowledgment && (
                  <Badge variant="outline" className="gap-1">
                    <AlertCircle className="size-3" /> נדרש אישור
                  </Badge>
                )}
                {d.msg.edited_at && (
                  <Badge variant="outline" className="gap-1">
                    <Pencil className="size-3" /> נערך
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                {formatHeDateTime(d.msg.created_at)}
                {d.msg.edited_at && (
                  <>
                    <br />
                    נערך לאחרונה ע״י {d.editor_name ?? "—"} · {formatHeDateTime(d.msg.edited_at)}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            {viewerMode === "inbox" && d.msg.sender_id && (
              <CommSenderHeader senderId={d.msg.sender_id} sentAt={d.msg.created_at} />
            )}

            <div className="whitespace-pre-wrap text-sm leading-relaxed">{d.msg.body}</div>

            {d.atts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">קבצים מצורפים</p>
                {d.atts.map((a: any) => (
                  <AttachmentLink key={a.id} att={a} />
                ))}
              </div>
            )}

            {viewerMode === "sent" && d.recipients.length > 0 && (
              <RecipientsBreakdown
                recipients={d.recipients}
                requiresAck={d.msg.requires_acknowledgment}
              />
            )}

            <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
              {viewerMode === "inbox" && (
                <>
                  {d.msg.requires_acknowledgment && (
                    <Button onClick={() => ackMut.mutate()} className="gap-1.5" disabled={ackMut.isPending}>
                      <CheckCheck className="size-4" /> קראתי והבנתי
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => archMut.mutate()} className="gap-1.5">
                    <Archive className="size-4" /> 📁 העבר לארכיון
                  </Button>
                </>
              )}
              {viewerMode === "sent" && canViewReceipts && (
                <Button variant="outline" className="gap-1.5" onClick={() => setReceiptsOpen(true)}>
                  <Eye className="size-4" /> 👁️ אישורי קריאה
                </Button>
              )}
              {viewerMode === "sent" && canManage && (
                <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-4" /> ערוך
                </Button>
              )}
              {viewerMode === "sent" && canDelete && (
                <Button
                  variant="ghost"
                  className="text-destructive gap-1.5"
                  onClick={() => setDelOpen(true)}
                >
                  <Trash2 className="size-4" /> מחק
                </Button>
              )}
            </DialogFooter>

            {receiptsOpen && (
              <ReadReceiptsDialog
                targetId={messageId}
                onClose={() => setReceiptsOpen(false)}
              />
            )}

            {editOpen && (
              <EditMessageDialog
                messageId={messageId}
                initial={{
                  title: d.msg.title,
                  body: d.msg.body,
                  priority: d.msg.priority,
                  requires_acknowledgment: d.msg.requires_acknowledgment,
                }}
                onClose={() => setEditOpen(false)}
              />
            )}

            <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>⚠️ אישור מחיקה</AlertDialogTitle>
                  <AlertDialogDescription>
                    האם אתה בטוח שברצונך למחוק פריט זה?
                    <br />
                    המחיקה תסיר את ההודעה ואת כל ההתראות הקשורות מכל הנמענים.
                    <br />
                    לאחר המחיקה לא ניתן יהיה לשחזר את הנתונים.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 flex-wrap">
                  <AlertDialogCancel>❌ ביטול</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      setDelOpen(false);
                      permDelMut.mutate();
                    }}
                  >
                    🗑️ מחק
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Edit Message Dialog ----------------
function EditMessageDialog({
  messageId,
  initial,
  onClose,
}: {
  messageId: string;
  initial: { title: string; body: string; priority: CommPriority; requires_acknowledgment: boolean };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [priority, setPriority] = useState<CommPriority>(initial.priority);
  const [ack, setAck] = useState(initial.requires_acknowledgment);
  const [file, setFile] = useState<File | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      editMessage(messageId, {
        title,
        body,
        priority,
        requires_acknowledgment: ack,
        file,
      }),
    onSuccess: () => {
      toast.success("ההודעה עודכנה");
      qc.invalidateQueries({ queryKey: ["comm"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת הודעה</DialogTitle>
          <DialogDescription>הנמענים שכבר קראו יקבלו התראה על העדכון</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>כותרת</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>תוכן</Label>
            <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>עדיפות</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as CommPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">נמוכה</SelectItem>
                  <SelectItem value="normal">רגילה</SelectItem>
                  <SelectItem value="high">גבוהה</SelectItem>
                  <SelectItem value="urgent">דחופה</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Switch id="edit-ack" checked={ack} onCheckedChange={setAck} />
              <Label htmlFor="edit-ack">נדרש אישור קריאה</Label>
            </div>
          </div>
          <div>
            <Label>הוספת קובץ (אופציונלי)</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !title.trim() || !body.trim()}>
            {mut.isPending && <Loader2 className="ml-2 size-4 animate-spin" />}
            שמור שינויים
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentLink({ att }: { att: any }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    getAttachmentUrl(att.storage_path).then(setUrl);
  }, [att.storage_path]);
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <Paperclip className="size-4" />
      {att.file_name}
      <span className="text-xs text-muted-foreground">
        ({Math.round((att.file_size ?? 0) / 1024)} KB)
      </span>
    </a>
  );
}

function RecipientsBreakdown({
  recipients,
  requiresAck,
}: {
  recipients: any[];
  requiresAck: boolean;
}) {
  const total = recipients.length;
  const read = recipients.filter((r) => r.read_at).length;
  const ack = recipients.filter((r) => r.acknowledged_at).length;
  const readPct = total ? Math.round((read / total) * 100) : 0;
  const ackPct = total ? Math.round((ack / total) * 100) : 0;
  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-sm font-semibold">
        סטטוס נמענים — {read} מתוך {total} קראו ({readPct}%)
        {requiresAck && ` · ${ack}/${total} אישרו (${ackPct}%)`}
      </p>
      <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
        {recipients.map((r) => (
          <div
            key={r.user_id}
            className="flex items-center justify-between px-2 py-1.5 text-xs"
          >
            <div>
              <p className="font-medium">{r.profile?.full_name ?? "—"}</p>
              <p className="text-muted-foreground">{r.profile?.departments?.name ?? "—"}</p>
            </div>
            <div className="flex gap-1">
              {r.acknowledged_at ? (
                <Badge className="bg-emerald-100 text-emerald-900 border-0">אושר</Badge>
              ) : r.read_at ? (
                <Badge className="bg-sky-100 text-sky-900 border-0">נקרא</Badge>
              ) : (
                <Badge variant="outline">לא נקרא</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Compose dialog ----------------
function useDepartments() {
  return useQuery({
    queryKey: ["comm", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useEmployeesLite() {
  return useQuery({
    queryKey: ["comm", "employees-lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, department_id, departments(name)")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        full_name: r.full_name,
        department_id: r.department_id,
        department_name: r.departments?.name ?? "—",
      }));
    },
  });
}

function ComposeMessageDialog({
  open,
  onOpenChange,
  perms,
  admin,
  isDeptManager,
  myDeptId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  perms: PermsRow;
  admin: boolean;
  isDeptManager: boolean;
  myDeptId: string | null;
}) {
  const qc = useQueryClient();
  const depsQ = useDepartments();
  const empsQ = useEmployeesLite();

  const canAll = admin || !!perms.can_send_message_all;
  const canDept = admin || isDeptManager || !!perms.can_send_message_department;
  const canEmp = admin || isDeptManager || !!perms.can_send_message_employee;

  const [scope, setScope] = useState<"all" | "departments" | "users">(
    canAll ? "all" : canDept ? "departments" : "users",
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<CommPriority>("normal");
  const [requiresAck, setRequiresAck] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);

  const visibleDepts = useMemo(() => {
    const list = depsQ.data ?? [];
    if (admin) return list;
    if (isDeptManager && myDeptId) return list.filter((d) => d.id === myDeptId);
    return list;
  }, [depsQ.data, admin, isDeptManager, myDeptId]);

  const visibleEmps = useMemo(() => {
    const list = empsQ.data ?? [];
    if (admin) return list;
    if (isDeptManager && myDeptId) return list.filter((e) => e.department_id === myDeptId);
    return list;
  }, [empsQ.data, admin, isDeptManager, myDeptId]);

  const sendMut = useMutation({
    mutationFn: () =>
      sendMessage({
        title,
        body,
        priority,
        requires_acknowledgment: requiresAck,
        file,
        targets: {
          all: scope === "all",
          departments: scope === "departments" ? selectedDepts : [],
          users: scope === "users" ? selectedUsers : [],
        },
      }),
    onSuccess: () => {
      toast.success("ההודעה נשלחה");
      qc.invalidateQueries({ queryKey: ["comm"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בשליחת ההודעה"),
  });

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>הודעה חדשה</DialogTitle>
          <DialogDescription>בחר נמענים והקלד את תוכן ההודעה</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>כותרת</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>תוכן</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>עדיפות</Label>
              <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">נמוכה</SelectItem>
                  <SelectItem value="normal">רגילה</SelectItem>
                  <SelectItem value="high">גבוהה</SelectItem>
                  <SelectItem value="urgent">דחופה</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Switch
                id="req-ack"
                checked={requiresAck}
                onCheckedChange={setRequiresAck}
              />
              <Label htmlFor="req-ack" className="cursor-pointer">
                נדרש אישור קריאה
              </Label>
            </div>
          </div>

          <div>
            <Label>נמענים</Label>
            <Select value={scope} onValueChange={(v: any) => setScope(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {canAll && <SelectItem value="all">כל עובדי החברה</SelectItem>}
                {canDept && <SelectItem value="departments">מחלקות</SelectItem>}
                {canEmp && <SelectItem value="users">עובדים בודדים</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {scope === "departments" && (
            <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
              {visibleDepts.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDepts.includes(d.id)}
                    onChange={() => toggle(selectedDepts, setSelectedDepts, d.id)}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          )}

          {scope === "users" && (
            <div className="border rounded-md p-2 max-h-48 overflow-y-auto space-y-1">
              {visibleEmps.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(e.id)}
                    onChange={() => toggle(selectedUsers, setSelectedUsers, e.id)}
                  />
                  {e.full_name}
                  <span className="text-xs text-muted-foreground">({e.department_name})</span>
                </label>
              ))}
            </div>
          )}

          <div>
            <Label className="flex items-center gap-1.5">
              <Paperclip className="size-4" /> קובץ מצורף (אופציונלי)
            </Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button
            disabled={!title.trim() || !body.trim() || sendMut.isPending}
            onClick={() => sendMut.mutate()}
            className="gap-1.5"
          >
            {sendMut.isPending && <Loader2 className="size-4 animate-spin" />}
            <Send className="size-4" /> שלח
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Read Receipts Dialog (messages only) ----------------
function ReadReceiptsDialog({
  targetId,
  onClose,
}: {
  targetId: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["comm", "receipts", "message", targetId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_message_read_receipts" as any, {
        _message_id: targetId,
      } as any);
      if (error) throw error;
      return (data ?? []) as Array<{
        user_id: string;
        full_name: string;
        department_name: string | null;
        job_title: string | null;
        read_at: string | null;
        acknowledged_at?: string | null;
      }>;
    },
  });

  const rows = q.data ?? [];
  const total = rows.length;
  const read = rows.filter((r) => r.read_at).length;
  const unread = total - read;
  const pct = total ? Math.round((read / total) * 100) : 0;

  const readRows = rows.filter((r) => r.read_at);
  const unreadRows = rows.filter((r) => !r.read_at);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="size-5" /> אישורי קריאה
          </DialogTitle>
          <DialogDescription>פירוט מי קרא ומי טרם קרא</DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : q.isError ? (
          <p className="text-sm text-destructive">{(q.error as any)?.message ?? "שגיאה בטעינה"}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground">נמענים</p>
                <p className="text-2xl font-bold">{total}</p>
              </Card>
              <Card className="p-3 text-center bg-emerald-50">
                <p className="text-xs text-emerald-900">קראו</p>
                <p className="text-2xl font-bold text-emerald-900">{read}</p>
              </Card>
              <Card className="p-3 text-center bg-amber-50">
                <p className="text-xs text-amber-900">לא קראו</p>
                <p className="text-2xl font-bold text-amber-900">{unread}</p>
              </Card>
              <Card className="p-3 text-center bg-sky-50">
                <p className="text-xs text-sky-900">אחוז קריאה</p>
                <p className="text-2xl font-bold text-sky-900">{pct}%</p>
              </Card>
            </div>

            <Tabs defaultValue="read" className="mt-2">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="read">קראו ({read})</TabsTrigger>
                <TabsTrigger value="unread">עדיין לא קראו ({unread})</TabsTrigger>
              </TabsList>
              <TabsContent value="read" className="mt-3">
                {readRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">אף אחד עדיין לא קרא</p>
                ) : (
                  <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                    {readRows.map((r) => (
                      <div key={r.user_id} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{r.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.department_name ?? "—"} · {r.job_title ?? "—"}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground text-left">
                          {r.read_at && formatHeDateTime(r.read_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="unread" className="mt-3">
                {unreadRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">כולם קראו 🎉</p>
                ) : (
                  <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                    {unreadRows.map((r) => (
                      <div key={r.user_id} className="px-3 py-2 text-sm">
                        <p className="font-medium">{r.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.department_name ?? "—"} · {r.job_title ?? "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>סגור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
