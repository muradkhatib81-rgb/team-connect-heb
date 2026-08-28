import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  Music,
  Siren,
  Pin,
  PinOff,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/i18n";
import { useAuth } from "@/lib/use-auth";
import {
  AUDIO_ACCEPT,
  AUDIO_MAX_BYTES,
  DEFAULT_HIGHLIGHT_STYLE,
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  MORNING_BOARD_BUCKET as BUCKET,
  VIDEO_ACCEPT,
  VIDEO_MAX_BYTES,
  type MorningBoardItem,
  type MorningBoardItemType,
  type MorningBoardPriority,
  type MorningBoardStyle,
} from "@/lib/morning-board-types";
import { formatHeDateTime } from "@/lib/date-format";

function getMorningBoardTypeLabel(type: MorningBoardItemType): string {
  return i18n.t(`morningBoardManager.typeLabels.${type}`);
}

function getMorningBoardPriorityLabel(priority: MorningBoardPriority): string {
  return i18n.t(`morningBoardManager.priorityLabels.${priority}`);
}

function mediaHint(type: MorningBoardItemType): string {
  if (type === "image") return i18n.t("morningBoardManager.mediaHintImage");
  if (type === "video") return i18n.t("morningBoardManager.mediaHintVideo");
  if (type === "audio") return i18n.t("morningBoardManager.mediaHintAudio");
  return "";
}

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
  const { t } = useTranslation();
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
        .order("is_pinned", { ascending: false })
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MorningBoardItem[];
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
    onError: (e: any) => toast.error(e?.message ?? t("morningBoardManager.errReorder")),
  });

  const pinMut = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from("morning_board_items")
        .update({ is_pinned: pinned } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? t("morningBoardManager.errPin")),
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
      toast.success(t("morningBoardManager.itemDeleted"));
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? t("morningBoardManager.errDelete")),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{i18n.t("dashboard.manageContent")}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground me-2">{t("morningBoardManager.addLabel")}</span>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "image" })}>
            <ImagePlus className="size-4" />
            {t("morningBoardManager.typeImage")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "video" })}>
            <Video className="size-4" />
            {t("morningBoardManager.typeVideo")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "audio" })}>
            <Music className="size-4" />
            {t("morningBoardManager.typeAudio")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "announcement" })}>
            <Megaphone className="size-4" />
            {t("morningBoardManager.typeAnnouncement")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "add", type: "highlight" })}>
            <Siren className="size-4" />
            {t("morningBoardManager.typeHighlight")}
          </Button>
        </div>

        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {t("morningBoardManager.emptyBoard")}
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
                onPin={() => pinMut.mutate({ id: r.id, pinned: !r.is_pinned })}
                onDelete={() => {
                  if (window.confirm(t("morningBoardManager.confirmDelete"))) deleteMut.mutate(r);
                }}
                busy={moveMut.isPending || deleteMut.isPending || pinMut.isPending}
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

function ItemRow({
  row,
  canUp,
  canDown,
  onUp,
  onDown,
  onEdit,
  onPin,
  onDelete,
  busy,
}: {
  row: MorningBoardItem;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const now = Date.now();
  const scheduled = row.starts_at && new Date(row.starts_at).getTime() > now;
  const expired = row.expires_at && new Date(row.expires_at).getTime() <= now;

  return (
    <Card className="p-3 flex items-center gap-2">
      <div className="flex flex-col gap-1">
        <Button size="icon" variant="ghost" className="size-7" onClick={onUp} disabled={!canUp || busy} aria-label={t("morningBoardManager.moveUp")}>
          <ArrowUp className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" onClick={onDown} disabled={!canDown || busy} aria-label={t("morningBoardManager.moveDown")}>
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="rounded-full">{getMorningBoardTypeLabel(row.item_type)}</Badge>
          {row.is_pinned && <Badge className="rounded-full">{t("morningBoardManager.pinned")}</Badge>}
          {row.priority !== "normal" && (
            <Badge variant="outline" className="rounded-full">{getMorningBoardPriorityLabel(row.priority)}</Badge>
          )}
          {scheduled && <Badge variant="outline" className="rounded-full">{t("morningBoardManager.scheduled")}</Badge>}
          {expired && <Badge variant="destructive" className="rounded-full">{t("morningBoardManager.expired")}</Badge>}
        </div>
        <div className="font-medium truncate mt-1">{row.title || "—"}</div>
        {row.description && (
          <div className="text-xs text-muted-foreground line-clamp-1">{row.description}</div>
        )}
        {(row.starts_at || row.expires_at) && (
          <div className="text-[11px] text-muted-foreground mt-1">
            {row.starts_at && <>{t("morningBoardManager.startsAt")} {formatHeDateTime(row.starts_at)} · </>}
            {row.expires_at && <>{t("morningBoardManager.endsAt")} {formatHeDateTime(row.expires_at)}</>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" onClick={onPin} disabled={busy} aria-label={row.is_pinned ? t("morningBoardManager.unpin") : t("morningBoardManager.pin")}>
          {row.is_pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={onEdit} disabled={busy} aria-label={t("morningBoardManager.edit")}>
          <Pencil className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onDelete} disabled={busy} aria-label={t("morningBoardManager.delete")} className="text-destructive">
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

function acceptForType(type: MorningBoardItemType): string {
  if (type === "image") return IMAGE_ACCEPT;
  if (type === "video") return VIDEO_ACCEPT;
  if (type === "audio") return AUDIO_ACCEPT;
  return "";
}

function maxBytesForType(type: MorningBoardItemType): number {
  if (type === "image") return IMAGE_MAX_BYTES;
  if (type === "video") return VIDEO_MAX_BYTES;
  if (type === "audio") return AUDIO_MAX_BYTES;
  return 0;
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
  const { t } = useTranslation();
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
  const [isPinned, setIsPinned] = useState<boolean>(row?.is_pinned ?? false);
  const [priority, setPriority] = useState<MorningBoardPriority>(row?.priority ?? "normal");
  const [style, setStyle] = useState<MorningBoardStyle>(() => {
    if (type === "highlight") return { ...DEFAULT_HIGHLIGHT_STYLE, ...(row?.style ?? {}) };
    return row?.style ?? {};
  });
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isMedia = type === "image" || type === "video" || type === "audio";
  const needsFile = isMedia && !isEdit;
  const accept = acceptForType(type);
  const maxBytes = maxBytesForType(type);

  const validateFile = (f: File): string | null => {
    const okTypes = accept.split(",").map((s) => s.trim());
    if (!okTypes.includes(f.type)) return t("morningBoardManager.errUnsupportedFormat");
    if (f.size > maxBytes) {
      return t("morningBoardManager.errFileTooLarge", { hint: mediaHint(type) });
    }
    return null;
  };

  async function uploadFile(itemId: string, f: File): Promise<string> {
    const ext = f.name.split(".").pop()?.toLowerCase() || (type === "video" ? "mp4" : type === "audio" ? "mp3" : "jpg");
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
      if ((type === "announcement" || type === "highlight") && !title.trim()) {
        throw new Error(t("morningBoardManager.errTitleRequired"));
      }
      if (needsFile && !file) throw new Error(t("morningBoardManager.errFileRequired"));
      if (file) {
        const err = validateFile(file);
        if (err) throw new Error(err);
      }

      const commonFields = {
        title: title.trim() || null,
        description: description.trim() || null,
        starts_at: fromLocalInputValue(startsAt),
        expires_at: fromLocalInputValue(expiresAt),
        is_pinned: isPinned,
        priority,
        style,
      };

      if (!isEdit) {
        const nextOrder = existing.length
          ? Math.max(...existing.map((r) => r.display_order)) + 1
          : 0;
        const { data: inserted, error: insErr } = await supabase
          .from("morning_board_items")
          .insert({
            branch_id: branchId,
            item_type: type,
            ...commonFields,
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
            await supabase.from("morning_board_items").delete().eq("id", inserted.id);
            throw e;
          }
        }
        toast.success(t("morningBoardManager.itemAdded"));
      } else {
        let newPath = row!.storage_path;
        if (file) {
          newPath = await uploadFile(row!.id, file);
        }
        const { error } = await supabase
          .from("morning_board_items")
          .update({
            ...commonFields,
            storage_path: newPath,
            mime_type: file?.type ?? row!.mime_type,
            file_size: file?.size ?? row!.file_size,
          } as any)
          .eq("id", row!.id);
        if (error) throw error;
        if (file && row!.storage_path && row!.storage_path !== newPath) {
          await supabase.storage.from(BUCKET).remove([row!.storage_path]).catch(() => {});
        }
        toast.success(t("morningBoardManager.itemUpdated"));
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? t("morningBoardManager.errSave"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("morningBoardManager.editItem") : t("morningBoardManager.addItem")} — {getMorningBoardTypeLabel(type)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {isMedia && (
            <div>
              <Label>{t("morningBoardManager.fileLabel")} {isEdit ? t("morningBoardManager.fileOptionalReplace") : ""}</Label>
              <Input
                ref={fileRef}
                type="file"
                accept={accept}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">{mediaHint(type)}</p>
            </div>
          )}

          <div>
            <Label>
              {t("morningBoardManager.titleLabel")}{" "}
              {type === "announcement" || type === "highlight"
                ? t("morningBoardManager.required")
                : t("morningBoardManager.optional")}
            </Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div>
            <Label>{t("morningBoardManager.descriptionLabel")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t("morningBoardManager.priorityLabel")}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as MorningBoardPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys({ normal: 1, important: 1, urgent: 1, critical: 1 }) as MorningBoardPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>{getMorningBoardPriorityLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => setIsPinned(e.target.checked)}
                  className="size-4"
                />
                {t("morningBoardManager.pinToTop")}
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t("morningBoardManager.startDateLabel")}</Label>
              <Input dir="ltr" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div>
              <Label>{t("morningBoardManager.endDateLabel")}</Label>
              <Input dir="ltr" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("morningBoardManager.scheduleHint")}
          </p>

          {type === "highlight" && <HighlightStyleEditor value={style} onChange={setStyle} />}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : isEdit ? <Replace className="size-4" /> : <Plus className="size-4" />}
            {isEdit ? t("morningBoardManager.saveChanges") : t("morningBoardManager.add")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColorField({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  fallback: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded border border-input bg-background cursor-pointer"
          aria-label={label}
        />
        <Input dir="ltr" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} className="flex-1" />
      </div>
    </div>
  );
}

function HighlightStyleEditor({
  value,
  onChange,
}: {
  value: MorningBoardStyle;
  onChange: (v: MorningBoardStyle) => void;
}) {
  const { t } = useTranslation();
  const v: MorningBoardStyle = { ...DEFAULT_HIGHLIGHT_STYLE, ...value };
  const set = (patch: Partial<MorningBoardStyle>) => onChange({ ...v, ...patch });

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
      <div className="font-semibold text-sm">{t("morningBoardManager.highlightStyleTitle")}</div>
      <div className="grid grid-cols-2 gap-2">
        <ColorField label={t("morningBoardManager.borderColor")} value={v.borderColor} fallback="#dc2626" onChange={(c) => set({ borderColor: c })} />
        <ColorField label={t("morningBoardManager.backgroundColor")} value={v.backgroundColor} fallback="#fef2f2" onChange={(c) => set({ backgroundColor: c })} />
        <ColorField label={t("morningBoardManager.titleColor")} value={v.titleColor} fallback="#991b1b" onChange={(c) => set({ titleColor: c })} />
        <ColorField label={t("morningBoardManager.textColor")} value={v.textColor} fallback="#450a0a" onChange={(c) => set({ textColor: c })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t("morningBoardManager.borderWidth")}</Label>
          <Select value={String(v.borderWidth ?? 2)} onValueChange={(x) => set({ borderWidth: Number(x) as 1 | 2 | 3 | 4 })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t("morningBoardManager.sizeThin")}</SelectItem>
              <SelectItem value="2">{t("morningBoardManager.sizeMedium")}</SelectItem>
              <SelectItem value="3">{t("morningBoardManager.sizeThick")}</SelectItem>
              <SelectItem value="4">{t("morningBoardManager.sizeVeryThick")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("morningBoardManager.borderRadius")}</Label>
          <Select value={v.radius ?? "lg"} onValueChange={(x) => set({ radius: x as MorningBoardStyle["radius"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">{t("morningBoardManager.sizeSmall")}</SelectItem>
              <SelectItem value="md">{t("morningBoardManager.sizeMedium")}</SelectItem>
              <SelectItem value="lg">{t("morningBoardManager.sizeLarge")}</SelectItem>
              <SelectItem value="xl">{t("morningBoardManager.sizeVeryLarge")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("morningBoardManager.fontSize")}</Label>
          <Select value={v.fontSize ?? "lg"} onValueChange={(x) => set({ fontSize: x as MorningBoardStyle["fontSize"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">{t("morningBoardManager.sizeSmall")}</SelectItem>
              <SelectItem value="md">{t("morningBoardManager.sizeMedium")}</SelectItem>
              <SelectItem value="lg">{t("morningBoardManager.sizeLarge")}</SelectItem>
              <SelectItem value="xl">{t("morningBoardManager.sizeVeryLarge")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("morningBoardManager.fontWeight")}</Label>
          <Select value={v.fontWeight ?? "bold"} onValueChange={(x) => set({ fontWeight: x as MorningBoardStyle["fontWeight"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">{t("morningBoardManager.weightRegular")}</SelectItem>
              <SelectItem value="bold">{t("morningBoardManager.weightBold")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("morningBoardManager.align")}</Label>
          <Select value={v.align ?? "right"} onValueChange={(x) => set({ align: x as MorningBoardStyle["align"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="right">{t("morningBoardManager.alignRight")}</SelectItem>
              <SelectItem value="center">{t("morningBoardManager.alignCenter")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("morningBoardManager.attention")}</Label>
          <Select value={v.attention ?? "pulse-title"} onValueChange={(x) => set({ attention: x as MorningBoardStyle["attention"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("morningBoardManager.attentionNone")}</SelectItem>
              <SelectItem value="glow">{t("morningBoardManager.attentionGlow")}</SelectItem>
              <SelectItem value="pulse-title">{t("morningBoardManager.attentionPulse")}</SelectItem>
              <SelectItem value="icon">{t("morningBoardManager.attentionIcon")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("morningBoardManager.icon")}</Label>
          <Select value={v.icon ?? "🚨"} onValueChange={(x) => set({ icon: x as MorningBoardStyle["icon"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("morningBoardManager.attentionNone")}</SelectItem>
              <SelectItem value="🚨">{t("morningBoardManager.iconEmergency")}</SelectItem>
              <SelectItem value="⚠️">{t("morningBoardManager.iconWarning")}</SelectItem>
              <SelectItem value="📢">{t("morningBoardManager.iconAnnouncement")}</SelectItem>
              <SelectItem value="ℹ️">{t("morningBoardManager.iconInfo")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
