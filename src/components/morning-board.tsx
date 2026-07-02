import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useCanManageMorningBoard } from "@/lib/use-morning-board-perm";
import { ImageLightbox } from "@/components/image-lightbox";
import { MorningBoardManager } from "@/components/morning-board-manager";
import type { MorningBoardItem } from "@/lib/morning-board-types";

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
 * Morning Board — branch-scoped content center.
 *
 * Displays every visible item for the active branch, in saved order.
 * Managers see a "Manage content" button that opens the manager dialog.
 * Nothing is rendered for read-only viewers when the branch has no visible
 * items, so the dashboard layout stays unchanged.
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("morning_board_items")
        .select("*")
        .eq("branch_id", activeBranchId!)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as MorningBoardItem[];
      const urls: Record<string, string | null> = {};
      await Promise.all(
        rows
          .filter((r) => r.storage_path)
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

  // Refresh scheduled visibility roughly every minute.
  useEffect(() => {
    const t = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["morning-board", activeBranchId] });
    }, 60 * 1000);
    return () => window.clearInterval(t);
  }, [activeBranchId, qc]);

  const visible = useMemo(
    () => (q.data?.rows ?? []).filter((r) => isVisibleNow(r)),
    [q.data],
  );

  if (!activeBranchId) return null;
  if (q.isLoading) return null;

  // Read-only viewer with no visible content: render nothing.
  if (visible.length === 0 && !canManage) return null;

  return (
    <section aria-label={`לוח בוקר ${activeBranch?.name ?? ""}`} className="space-y-3">
      {canManage && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone className="size-5 text-primary" />
            לוח בוקר
          </h2>
          <Button size="sm" variant="outline" onClick={() => setManagerOpen(true)}>
            <Settings2 className="size-4" />
            ניהול תוכן
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          עדיין לא הוגדר תוכן ללוח הבוקר של הסניף.
        </Card>
      ) : (
        <div className="space-y-4">
          {visible.map((row) => (
            <MorningBoardItemView
              key={row.id}
              row={row}
              url={q.data?.urls[row.id] ?? null}
              onImageClick={(u) => setLightboxUrl(u)}
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

function MorningBoardItemView({
  row,
  url,
  onImageClick,
}: {
  row: MorningBoardItem;
  url: string | null;
  onImageClick: (url: string) => void;
}) {
  if (row.item_type === "image" && url) {
    return (
      <div className="rounded-xl overflow-hidden border border-border bg-muted/30">
        <button
          type="button"
          onClick={() => onImageClick(url)}
          className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={row.title ?? "הצג תמונה"}
        >
          <img
            src={url}
            alt={row.title ?? ""}
            className="block w-full h-auto object-contain"
            draggable={false}
          />
        </button>
        {(row.title || row.description) && (
          <div className="p-3 text-sm">
            {row.title && <div className="font-semibold">{row.title}</div>}
            {row.description && (
              <div className="text-muted-foreground whitespace-pre-wrap">{row.description}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (row.item_type === "video" && url) {
    return (
      <div className="rounded-xl overflow-hidden border border-border bg-black">
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="block w-full h-auto max-h-[70vh]"
        />
        {(row.title || row.description) && (
          <div className="p-3 text-sm bg-background">
            {row.title && <div className="font-semibold">{row.title}</div>}
            {row.description && (
              <div className="text-muted-foreground whitespace-pre-wrap">{row.description}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (row.item_type === "announcement") {
    return (
      <Card className="p-4 border-r-4 border-r-primary">
        <div className="flex items-start gap-3">
          <Megaphone className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            {row.title && <div className="font-semibold">{row.title}</div>}
            {row.description && (
              <div className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">
                {row.description}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return null;
}
