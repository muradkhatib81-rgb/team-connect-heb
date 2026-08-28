import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, Megaphone, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useCanManageMorningBoard } from "@/lib/use-morning-board-perm";
import { ImageLightbox } from "@/components/image-lightbox";
import { MorningBoardManager } from "@/components/morning-board-manager";
import {
  DEFAULT_HIGHLIGHT_STYLE,
  FONT_SIZE_CLASS,
  PRIORITY_BADGE_CLASS,
  PRIORITY_LABEL,
  RADIUS_CLASS,
  type MorningBoardItem,
  type MorningBoardStyle,
} from "@/lib/morning-board-types";
import i18n from "@/i18n";
import { BilingualContent } from "@/components/bilingual-content";
import { pickBilingualResult, useBilingualContentMap } from "@/lib/use-bilingual-content";
import type { TranslateContentResult } from "@/lib/translate-content.functions";

const BUCKET = "morning-board";

async function signedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

function isVisibleNow(row: MorningBoardItem, now = Date.now()) {
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false;
  return true;
}

/**
 * Main Board — branch-scoped real-time communication center.
 *
 * Supports images, videos, audio, plain announcements and highlighted
 * announcements. Pinned items are always rendered first, then by display order.
 */
export function MorningBoard() {
  const { activeBranchId, activeBranch } = useActiveBranch();
  const canManage = useCanManageMorningBoard(activeBranchId);
  const qc = useQueryClient();
  const [managerOpen, setManagerOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const q = useQuery({
    enabled: !!activeBranchId,
    queryKey: ["morning-board", activeBranchId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("morning_board_items")
        .select(
          "id, branch_id, item_type, title, description, storage_path, mime_type, is_pinned, display_order, priority, style, starts_at, expires_at, created_at, created_by",
        )
        .eq("branch_id", activeBranchId!)
        .order("is_pinned", { ascending: false })
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as MorningBoardItem[];
      const now = Date.now();
      const urls: Record<string, string | null> = {};
      await Promise.all(
        rows
          .filter((r) => r.storage_path)
          .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
          .map(async (r) => {
            urls[r.id] = await signedUrl(r.storage_path);
          }),
      );
      return { rows, urls };
    },
  });

  useEffect(() => {
    if (!activeBranchId) return;
    const ch = supabase
      .channel(`morning-board-${activeBranchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "morning_board_items",
          filter: `branch_id=eq.${activeBranchId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["morning-board", activeBranchId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeBranchId, qc]);

  const [nowTick, setNowTick] = useState(() => Date.now());

  // Schedule a precise re-render at the next start_at / expires_at boundary
  // so ads appear / disappear instantly without a page refresh. Falls back to
  // a 30s safety tick.
  useEffect(() => {
    const rows = q.data?.rows ?? [];
    const now = Date.now();
    const upcoming: number[] = [];
    for (const r of rows) {
      if (r.starts_at) {
        const t = new Date(r.starts_at).getTime();
        if (t > now) upcoming.push(t);
      }
      if (r.expires_at) {
        const t = new Date(r.expires_at).getTime();
        if (t > now) upcoming.push(t);
      }
    }
    const nextBoundary = upcoming.length ? Math.min(...upcoming) : now + 30_000;
    const delay = Math.max(500, Math.min(nextBoundary - now + 250, 30_000));
    const t = window.setTimeout(() => setNowTick(Date.now()), delay);
    return () => window.clearTimeout(t);
  }, [q.data, nowTick]);

  const visible = useMemo(
    () => (q.data?.rows ?? []).filter((r) => isVisibleNow(r, nowTick)),
    [q.data, nowTick],
  );

  const bilingualItems = useMemo(
    () =>
      visible.flatMap((row) => {
        if (!row.created_by) return [];
        const items = [];
        if (row.title?.trim()) {
          items.push({
            key: `${row.id}-title`,
            entityType: "morning_board_item" as const,
            entityId: row.id,
            field: "title" as const,
            text: row.title,
            authorId: row.created_by,
          });
        }
        if (row.description?.trim()) {
          items.push({
            key: `${row.id}-description`,
            entityType: "morning_board_item" as const,
            entityId: row.id,
            field: "description" as const,
            text: row.description,
            authorId: row.created_by,
          });
        }
        return items;
      }),
    [visible],
  );

  const { map: bilingualMap, isLoading: bilingualLoading } = useBilingualContentMap(
    bilingualItems,
    visible.length > 0,
  );

  if (!activeBranchId) return null;
  if (q.isLoading) return null;
  if (visible.length === 0 && !canManage) return null;

  return (
    <section aria-label={`${i18n.t("dashboard.mainBoard")} ${activeBranch?.name ?? ""}`} className="space-y-3">
      {canManage && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone className="size-5 text-primary" />
            {i18n.t("dashboard.mainBoard")}
          </h2>
          <Button size="sm" variant="outline" onClick={() => setManagerOpen(true)}>
            <Settings2 className="size-4" />
            {i18n.t("dashboard.manageContent")}
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {i18n.t("dashboard.noBoardContent")}
        </Card>
      ) : (
        <div className="space-y-4">
          {visible.map((row) => (
            <MorningBoardItemView
              key={row.id}
              row={row}
              url={q.data?.urls[row.id] ?? null}
              onImageClick={(u) => setLightboxUrl(u)}
              bilingualMap={bilingualMap}
              bilingualLoading={bilingualLoading}
            />
          ))}
        </div>
      )}

      {canManage && (
        <MorningBoardManager
          open={managerOpen}
          onClose={() => setManagerOpen(false)}
          branchId={activeBranchId}
        />
      )}

      {lightboxUrl && (
        <ImageLightbox
          images={[{ url: lightboxUrl, alt: "" }]}
          initialIndex={0}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </section>
  );
}

function PinBadge() {
  return (
    <div className="absolute -top-2 -start-2 flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[11px] px-2 py-0.5 shadow">
      <Pin className="size-3" />
      {i18n.t("dashboard.pinned")}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: MorningBoardItem["priority"] }) {
  if (priority === "normal") return null;
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE_CLASS[priority]}`}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

function BoardText({
  rowId,
  field,
  text,
  className,
  inline,
  bilingualMap,
  bilingualLoading,
}: {
  rowId: string;
  field: "title" | "description";
  text: string;
  className?: string;
  inline?: boolean;
  bilingualMap: Record<string, TranslateContentResult | undefined>;
  bilingualLoading: boolean;
}) {
  const key = `${rowId}-${field}`;
  return (
    <BilingualContent
      text={text}
      result={pickBilingualResult(bilingualMap, key, text)}
      loading={bilingualLoading}
      className={className}
      inline={inline}
    />
  );
}

function MorningBoardItemView({
  row,
  url,
  onImageClick,
  bilingualMap,
  bilingualLoading,
}: {
  row: MorningBoardItem;
  url: string | null;
  onImageClick: (url: string) => void;
  bilingualMap: Record<string, TranslateContentResult | undefined>;
  bilingualLoading: boolean;
}) {
  const wrapCls = row.is_pinned ? "relative" : "";

  if (row.item_type === "image" && url) {
    return (
      <div className={`${wrapCls} rounded-xl overflow-hidden border border-border bg-muted/30`}>
        {row.is_pinned && <PinBadge />}
        <button
          type="button"
          onClick={() => onImageClick(url)}
          className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={row.title ?? i18n.t("dashboard.mainBoard")}
        >
          <img src={url} alt={row.title ?? ""} className="block w-full h-auto object-contain" draggable={false} />
        </button>
        {(row.title || row.description) && (
          <div className="p-3 text-sm flex items-center gap-2 flex-wrap">
            <PriorityBadge priority={row.priority} />
            {row.title && (
              <BoardText
                rowId={row.id}
                field="title"
                text={row.title}
                className="font-semibold"
                inline
                bilingualMap={bilingualMap}
                bilingualLoading={bilingualLoading}
              />
            )}
            {row.description && (
              <BoardText
                rowId={row.id}
                field="description"
                text={row.description}
                className="text-muted-foreground whitespace-pre-wrap w-full"
                bilingualMap={bilingualMap}
                bilingualLoading={bilingualLoading}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  if (row.item_type === "video" && url) {
    return (
      <div className={`${wrapCls} rounded-xl overflow-hidden border border-border bg-black`}>
        {row.is_pinned && <PinBadge />}
        <video src={url} controls playsInline preload="metadata" className="block w-full h-auto max-h-[70vh]" />
        {(row.title || row.description) && (
          <div className="p-3 text-sm bg-background flex items-center gap-2 flex-wrap">
            <PriorityBadge priority={row.priority} />
            {row.title && (
              <BoardText
                rowId={row.id}
                field="title"
                text={row.title}
                className="font-semibold"
                inline
                bilingualMap={bilingualMap}
                bilingualLoading={bilingualLoading}
              />
            )}
            {row.description && (
              <BoardText
                rowId={row.id}
                field="description"
                text={row.description}
                className="text-muted-foreground whitespace-pre-wrap w-full"
                bilingualMap={bilingualMap}
                bilingualLoading={bilingualLoading}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  if (row.item_type === "audio" && url) {
    return (
      <Card className={`${wrapCls} p-4`}>
        {row.is_pinned && <PinBadge />}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-lg">🔊</span>
          <PriorityBadge priority={row.priority} />
          {row.title && (
            <BoardText
              rowId={row.id}
              field="title"
              text={row.title}
              className="font-semibold"
              inline
              bilingualMap={bilingualMap}
              bilingualLoading={bilingualLoading}
            />
          )}
        </div>
        {row.description && (
          <BoardText
            rowId={row.id}
            field="description"
            text={row.description}
            className="text-sm text-muted-foreground whitespace-pre-wrap mb-2"
            bilingualMap={bilingualMap}
            bilingualLoading={bilingualLoading}
          />
        )}
        <audio src={url} controls preload="metadata" className="w-full" />
      </Card>
    );
  }

  if (row.item_type === "announcement") {
    return (
      <Card className={`${wrapCls} p-4 border-r-4 border-r-primary`}>
        {row.is_pinned && <PinBadge />}
        <div className="flex items-start gap-3">
          <Megaphone className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <PriorityBadge priority={row.priority} />
              {row.title && (
                <BoardText
                  rowId={row.id}
                  field="title"
                  text={row.title}
                  className="font-semibold"
                  inline
                  bilingualMap={bilingualMap}
                  bilingualLoading={bilingualLoading}
                />
              )}
            </div>
            {row.description && (
              <BoardText
                rowId={row.id}
                field="description"
                text={row.description}
                className="text-sm text-muted-foreground whitespace-pre-wrap mt-1"
                bilingualMap={bilingualMap}
                bilingualLoading={bilingualLoading}
              />
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (row.item_type === "highlight") {
    return (
      <HighlightView
        row={row}
        bilingualMap={bilingualMap}
        bilingualLoading={bilingualLoading}
      />
    );
  }

  return null;
}

function HighlightView({
  row,
  bilingualMap,
  bilingualLoading,
}: {
  row: MorningBoardItem;
  bilingualMap: Record<string, TranslateContentResult | undefined>;
  bilingualLoading: boolean;
}) {
  const s: MorningBoardStyle = { ...DEFAULT_HIGHLIGHT_STYLE, ...(row.style ?? {}) };
  const radius = RADIUS_CLASS[s.radius ?? "lg"];
  const fontSize = FONT_SIZE_CLASS[s.fontSize ?? "lg"];
  const weight = s.fontWeight === "bold" ? "font-bold" : "font-normal";
  const align = s.align === "center" ? "text-center" : "text-right";
  const glow = s.attention === "glow";
  const pulseTitle = s.attention === "pulse-title";

  const style: React.CSSProperties = {
    borderColor: s.borderColor,
    backgroundColor: s.backgroundColor,
    color: s.textColor,
    borderWidth: s.borderWidth ?? 2,
    borderStyle: "solid",
    boxShadow: glow ? `0 0 0 4px ${s.borderColor}33, 0 0 24px ${s.borderColor}66` : undefined,
  };

  const showIcon = (s.attention === "icon" || s.icon) && s.icon && s.icon !== "none";

  return (
    <div className={`relative ${radius} p-4 ${align}`} style={style} role="alert">
      {row.is_pinned && <PinBadge />}
      <div className="flex items-start gap-3 justify-start">
        {showIcon && (
          <span className={`text-2xl leading-none ${pulseTitle ? "" : ""}`} aria-hidden>
            {s.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <PriorityBadge priority={row.priority} />
            {row.title && (
              <div
                className={`${fontSize} ${weight} ${pulseTitle ? "animate-pulse" : ""}`}
                style={{ color: s.titleColor }}
              >
                <BoardText
                  rowId={row.id}
                  field="title"
                  text={row.title}
                  inline
                  bilingualMap={bilingualMap}
                  bilingualLoading={bilingualLoading}
                />
              </div>
            )}
          </div>
          {row.description && (
            <BoardText
              rowId={row.id}
              field="description"
              text={row.description}
              className={`${fontSize} ${weight === "font-bold" ? "font-medium" : ""} whitespace-pre-wrap mt-2 opacity-95`}
              bilingualMap={bilingualMap}
              bilingualLoading={bilingualLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}
