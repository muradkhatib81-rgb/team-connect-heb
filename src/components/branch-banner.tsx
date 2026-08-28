import { useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Loader2,
  ImagePlus,
  MoreVertical,
  Replace,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useCanManageMorningBoard } from "@/lib/use-morning-board-perm";
import { ImageLightbox } from "@/components/image-lightbox";

/**
 * Branch-specific Main Board banner.
 *
 * - Displays a single image per branch at full width, preserving aspect ratio.
 * - Reusable shape: `branch_banners` schema already carries optional title,
 *   description, starts_at, expires_at for future enhancements.
 * - Authorized users (Platform Owners, Branch Managers of the same branch,
 *   or users with the `can_manage_morning_board` permission) see an
 *   Upload / Replace / Remove menu. Everyone else has read-only access.
 * - Nothing is rendered when the branch has no banner AND the viewer is
 *   read-only. Managers still see an "Upload" affordance.
 */

const BUCKET = "branch-banners";
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

type BannerRow = {
  id: string;
  branch_id: string;
  image_path: string;
  title: string | null;
  description: string | null;
  starts_at: string | null;
  expires_at: string | null;
};

async function signUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export function BranchBanner() {
  const { t } = useTranslation();
  const { activeBranchId, activeBranch } = useActiveBranch();
  const canManage = useCanManageMorningBoard(activeBranchId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [lightbox, setLightbox] = useState(false);

  const q = useQuery({
    enabled: !!activeBranchId,
    queryKey: ["branch-banner", activeBranchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_banners")
        .select("id, branch_id, image_path, title, description, starts_at, expires_at")
        .eq("branch_id", activeBranchId!)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as BannerRow | null;
      const url = row ? await signUrl(row.image_path) : null;
      return { row, url };
    },
  });

  // Realtime: RealtimeBridge invalidates ["branch-banner", activeBranchId].

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      if (!activeBranchId) throw new Error(t("branchBanner.noActiveBranch"));
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error(t("branchBanner.unsupportedFormat"));
      }
      if (file.size > MAX_BYTES) {
        throw new Error(t("branchBanner.fileTooLarge"));
      }

      // Remove previous object (if any) so we don't accumulate storage.
      const prev = q.data?.row?.image_path ?? null;

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${activeBranchId}/banner-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase
        .from("branch_banners")
        .upsert(
          { branch_id: activeBranchId, image_path: path },
          { onConflict: "branch_id" },
        );
      if (dbErr) {
        // best-effort rollback of the storage object
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw dbErr;
      }

      if (prev && prev !== path) {
        await supabase.storage.from(BUCKET).remove([prev]).catch(() => {});
      }
    },
    onSuccess: () => {
      toast.success(t("branchBanner.imageUpdated"));
      qc.invalidateQueries({ queryKey: ["branch-banner", activeBranchId] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("branchBanner.uploadError")),
  });

  const removeMut = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error(t("branchBanner.noActiveBranch"));
      const path = q.data?.row?.image_path ?? null;
      const { error } = await supabase
        .from("branch_banners")
        .delete()
        .eq("branch_id", activeBranchId);
      if (error) throw error;
      if (path) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      }
    },
    onSuccess: () => {
      toast.success(t("branchBanner.imageRemoved"));
      qc.invalidateQueries({ queryKey: ["branch-banner", activeBranchId] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("branchBanner.deleteError")),
  });

  const onPick = () => fileRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) uploadMut.mutate(f);
  };

  const busy = uploadMut.isPending || removeMut.isPending;
  const url = q.data?.url ?? null;
  const hasImage = !!url;
  const branchName = activeBranch?.name ?? "";

  // Read-only viewer with no image: render nothing.
  if (!activeBranchId) return null;
  if (!hasImage && !canManage) return null;
  if (q.isLoading) return null;

  return (
    <section
      aria-label={t("branchBanner.sectionLabel", { name: branchName })}
      className="relative overflow-hidden rounded-xl border border-border bg-muted/30"
    >
      {hasImage ? (
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("branchBanner.viewLarge")}
        >
          <img
            src={url!}
            alt={q.data?.row?.title ?? t("branchBanner.altBanner", { name: branchName })}
            className="block w-full h-auto object-contain"
            draggable={false}
          />
        </button>
      ) : (
        <div className="p-6 sm:p-8 flex flex-col items-center justify-center gap-3 text-center">
          <ImagePlus className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {t("branchBanner.noImageYet")}
          </p>
          <Button size="sm" onClick={onPick} disabled={busy}>
            {uploadMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImagePlus className="size-4" />
            )}
            {t("branchBanner.uploadImage")}
          </Button>
        </div>
      )}

      {canManage && hasImage && (
        <div className="absolute top-2 left-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="secondary"
                className="size-9 rounded-full shadow-md bg-background/90 backdrop-blur hover:bg-background"
                aria-label={t("branchBanner.manageBanner")}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MoreVertical className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onPick}>
                <Replace className="size-4" />
                {t("branchBanner.replaceImage")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (window.confirm(t("branchBanner.confirmRemove"))) {
                    removeMut.mutate();
                  }
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                {t("branchBanner.removeImage")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onFile}
      />

      {lightbox && url && (
        <ImageLightbox
          images={[{ url, alt: q.data?.row?.title ?? "" }]}
          initialIndex={0}
          onClose={() => setLightbox(false)}
        />
      )}
    </section>
  );
}
