import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
  ImagePlus,
  Video,
  Megaphone,
  Plus,
  Replace,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  MORNING_BOARD_BUCKET as BUCKET,
  VIDEO_ACCEPT,
  VIDEO_MAX_BYTES,
  type MorningBoardItem,
  type MorningBoardItemType,
} from "@/lib/morning-board-types";
import { formatHeDateTime } from "@/lib/date-format";

type EditorState =
  | { mode: "add"; type: MorningBoardItemType }
  | { mode: "edit"; row: MorningBoardItem }
  | null;

export function MorningBoardManager({
  open,
  onClose,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
}) {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<EditorState>(null);

  const q = useQuery({
    enabled: open,
    queryKey: ["morning-board-manager", branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("morning_board_items")
        .select("*")
        .eq("branch_id", branchId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MorningBoardItem[];
    },
  });

  const rows = q.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["morning-board-manager", branchId] });
    qc.invalidateQueries({ queryKey: ["morning-board", branchId] });
  };

  const moveMut = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: -1 | 1 }) => {
      const idx = rows.findIndex((r) => r.id === id);
      const other = rows[idx + dir];
      if (!other) return;
      const a = rows[idx];
      // Assign fresh normalized orders to avoid ties.
      await Promise.all(
        rows.map((r, i) => {
          let newOrder = i;
          if (r.id === a.id) newOrder = idx + dir;
          else if (r.id === other.id) newOrder = idx;
          if (newOrder === r.display_order) return null;
          return supabase
            .from("morning_board_items")
            .update({ display_order: newOrder })
            .eq("id", r.id);
        }),
      );
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בסידור"),
  });

  const deleteMut = useMutation({
    mutationFn: async (row: MorningBoardItem) => {
      if (row.storage_path) {
        await supabase.storage.from(BUCKET).remove([row.storage_path]).catch(() => {});
      }
      const { error } = await supabase
        .from("morning_board_items")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("הפריט נמחק");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ניהול תוכן לוח בוקר</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground me-2">➕ הוסף:</span>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "image" })}>
            <ImagePlus className="size-4" />
            תמונה
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "video" })}>
            <Video className="size-4" />
            סרטון
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "announcement" })}>
            <Megaphone className="size-4" />
            הודעה
          </Button>
        </div>

        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            עדיין לא נוסף תוכן ללוח הבוקר.
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <ItemRow
                key={r.id}
                row={r}
                canUp={i > 0}
                canDown={i < rows.length - 1}
                onUp={() => moveMut.mutate({ id: r.id, dir: -1 })}
                onDown={() => moveMut.mutate({ id: r.id, dir: 1 })}
                onEdit={() => setEditor({ mode: "edit", row: r })}
                onDelete={() => {
                  if (window.confirm("למחוק את הפריט?")) deleteMut.mutate(r);
                }}
                busy={moveMut.isPending || deleteMut.isPending}
              />
            ))}
          </div>
        )}

        {editor && (
          <ItemEditorDialog
            state={editor}
            branchId={branchId}
            existing={rows}
            onClose={() => setEditor(null)}
            onSaved={() => {
              invalidate();
              setEditor(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function typeLabel(t: MorningBoardItemType) {
  if (t === "image") return "🖼 תמונה";
  if (t === "video") return "🎥 סרטון";
  return "📢 הודעה";
}

function ItemRow({
  row,
  canUp,
  canDown,
  onUp,
  onDown,
  onEdit,
  onDelete,
  busy,
}: {
  row: MorningBoardItem;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const now = Date.now();
  const scheduled = row.starts_at && new Date(row.starts_at).getTime() > now;
  const expired = row.expires_at && new Date(row.expires_at).getTime() <= now;

  return (
    <Card className="p-3 flex items-center gap-2">
      <div className="flex flex-col gap-1">
        <Button size="icon" variant="ghost" className="size-7" onClick={onUp} disabled={!canUp || busy} aria-label="הזז למעלה">
          <ArrowUp className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" onClick={onDown} disabled={!canDown || busy} aria-label="הזז למטה">
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="rounded-full">{typeLabel(row.item_type)}</Badge>
          {scheduled && <Badge variant="outline" className="rounded-full">מתוזמן</Badge>}
          {expired && <Badge variant="destructive" className="rounded-full">פג תוקף</Badge>}
        </div>
        <div className="font-medium truncate mt-1">{row.title || "—"}</div>
        {row.description && (
          <div className="text-xs text-muted-foreground line-clamp-1">{row.description}</div>
        )}
        {(row.starts_at || row.expires_at) && (
          <div className="text-[11px] text-muted-foreground mt-1">
            {row.starts_at && <>מתחיל: {formatHeDateTime(row.starts_at)} · </>}
            {row.expires_at && <>מסתיים: {formatHeDateTime(row.expires_at)}</>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" onClick={onEdit} disabled={busy} aria-label="עריכה">
          <Pencil className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onDelete} disabled={busy} aria-label="מחיקה" className="text-destructive">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function fromLocalInputValue(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}

function ItemEditorDialog({
  state,
  branchId,
  existing,
  onClose,
  onSaved,
}: {
  state: NonNullable<EditorState>;
  branchId: string;
  existing: MorningBoardItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: profile } = useAuth();
  const isEdit = state.mode === "edit";
  const row = isEdit ? state.row : null;
  const type = isEdit ? state.row.item_type : state.type;

  const [title, setTitle] = useState(row?.title ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInputValue(row?.starts_at ?? null));
  const [expiresAt, setExpiresAt] = useState(toLocalInputValue(row?.expires_at ?? null));
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const needsFile = (type === "image" || type === "video") && !isEdit;
  const accept = type === "image" ? IMAGE_ACCEPT : type === "video" ? VIDEO_ACCEPT : "";
  const maxBytes = type === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;

  const validateFile = (f: File): string | null => {
    const okTypes = accept.split(",");
    if (!okTypes.includes(f.type)) return "פורמט לא נתמך.";
    if (f.size > maxBytes) {
      return type === "video"
        ? "הקובץ גדול מדי. גודל מרבי 100MB."
        : "הקובץ גדול מדי. גודל מרבי 5MB.";
    }
    return null;
  };

  async function uploadFile(itemId: string, f: File): Promise<string> {
    const ext = f.name.split(".").pop()?.toLowerCase() || (type === "video" ? "mp4" : "jpg");
    const path = `${branchId}/${itemId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, f, { upsert: false, contentType: f.type });
    if (error) throw error;
    return path;
  }

  const handleSave = async () => {
    try {
      setSaving(true);
      if (type === "announcement" && !title.trim()) {
        throw new Error("יש להזין כותרת להודעה");
      }
      if (needsFile && !file) throw new Error("יש לבחור קובץ");
      if (file) {
        const err = validateFile(file);
        if (err) throw new Error(err);
      }

      if (!isEdit) {
        const nextOrder = existing.length
          ? Math.max(...existing.map((r) => r.display_order)) + 1
          : 0;
        const { data: inserted, error: insErr } = await supabase
          .from("morning_board_items")
          .insert({
            branch_id: branchId,
            item_type: type,
            title: title.trim() || null,
            description: description.trim() || null,
            starts_at: fromLocalInputValue(startsAt),
            expires_at: fromLocalInputValue(expiresAt),
            display_order: nextOrder,
            created_by: profile?.id ?? null,
          } as any)
          .select("id")
          .single();
        if (insErr) throw insErr;

        if (file) {
          try {
            const path = await uploadFile(inserted.id, file);
            const { error: updErr } = await supabase
              .from("morning_board_items")
              .update({ storage_path: path, mime_type: file.type, file_size: file.size } as any)
              .eq("id", inserted.id);
            if (updErr) throw updErr;
          } catch (e) {
            // Roll back the empty row so the item does not linger without media.
            await supabase.from("morning_board_items").delete().eq("id", inserted.id);
            throw e;
          }
        }
        toast.success("הפריט נוסף");
      } else {
        let newPath = row!.storage_path;
        if (file) {
          newPath = await uploadFile(row!.id, file);
        }
        const { error } = await supabase
          .from("morning_board_items")
          .update({
            title: title.trim() || null,
            description: description.trim() || null,
            starts_at: fromLocalInputValue(startsAt),
            expires_at: fromLocalInputValue(expiresAt),
            storage_path: newPath,
            mime_type: file?.type ?? row!.mime_type,
            file_size: file?.size ?? row!.file_size,
          } as any)
          .eq("id", row!.id);
        if (error) throw error;
        if (file && row!.storage_path && row!.storage_path !== newPath) {
          await supabase.storage.from(BUCKET).remove([row!.storage_path]).catch(() => {});
        }
        toast.success("הפריט עודכן");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "עריכת פריט" : "הוספת פריט"} — {typeLabel(type)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {(type === "image" || type === "video") && (
            <div>
              <Label>קובץ {isEdit ? "(אופציונלי — החלפה)" : ""}</Label>
              <Input
                ref={fileRef}
                type="file"
                accept={accept}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {type === "image"
                  ? "JPG / PNG / WEBP, עד 5MB"
                  : "MP4 / WEBM, עד 100MB"}
              </p>
            </div>
          )}

          <div>
            <Label>כותרת {type === "announcement" ? "*" : "(אופציונלי)"}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div>
            <Label>תיאור (אופציונלי)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>מתפרסם בתאריך (אופציונלי)</Label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div>
              <Label>תפוגה (אופציונלי)</Label>
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ללא תאריך התחלה: מתפרסם מיד. ללא תאריך תפוגה: נשאר עד למחיקה ידנית.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : isEdit ? <Replace className="size-4" /> : <Plus className="size-4" />}
            {isEdit ? "שמור שינויים" : "הוסף"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
