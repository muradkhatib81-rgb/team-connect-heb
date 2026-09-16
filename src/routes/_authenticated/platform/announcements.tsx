import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ImageOff, ImagePlus, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageLightbox } from "@/components/image-lightbox";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyContext } from "@/platform";
import { branchService } from "@/modules/branches";
import { usePlatformFeatureFlagState } from "@/lib/use-platform-feature-flags";
import {
  announcementImageExt,
  PLATFORM_ANNOUNCEMENT_IMAGE_ACCEPT,
  PLATFORM_ANNOUNCEMENT_IMAGE_BUCKET,
  PLATFORM_ANNOUNCEMENT_IMAGE_MAX_BYTES,
  scopeFromAnnouncementRow,
} from "@/lib/platform-announcements";
import {
  createPlatformAnnouncement,
  deletePlatformAnnouncement,
  listPlatformAnnouncementsAdmin,
  updatePlatformAnnouncement,
  type PlatformAnnouncementRow,
} from "@/lib/platform-announcements.functions";

export const Route = createFileRoute("/_authenticated/platform/announcements")({
  component: PlatformAnnouncementsPage,
});

function PlatformAnnouncementsPage() {
  const { t } = useTranslation();
  const flags = usePlatformFeatureFlagState();
  const qc = useQueryClient();
  const { companies } = useCompanyContext();
  const listFn = useServerFn(listPlatformAnnouncementsAdmin);
  const createFn = useServerFn(createPlatformAnnouncement);
  const updateFn = useServerFn(updatePlatformAnnouncement);
  const deleteFn = useServerFn(deletePlatformAnnouncement);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformAnnouncementRow | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"all" | "company" | "branch">("all");
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  const branchesQ = useQuery({
    queryKey: ["platform-all-branches"],
    queryFn: () => branchService.listAllBranches(),
    enabled: flags.announcements,
  });

  const listQ = useQuery({
    queryKey: ["platform-announcements-admin"],
    queryFn: () => listFn(),
    enabled: flags.announcements,
  });

  const branches = useMemo(
    () => (branchesQ.data ?? []).filter((b) => !companyId || b.companyId === companyId),
    [branchesQ.data, companyId],
  );

  function revokePreview(url: string | null) {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  function resetForm() {
    setEditing(null);
    setTitle("");
    setBody("");
    setScope("all");
    setCompanyId("");
    setBranchId("");
    setPendingFile(null);
    setRemoveImage(false);
    setPreviewUrl((prev) => {
      revokePreview(prev);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(row: PlatformAnnouncementRow) {
    revokePreview(previewUrl);
    const targeting = scopeFromAnnouncementRow(row);
    setEditing(row);
    setTitle(row.title);
    setBody(row.body);
    setScope(targeting.scope);
    setCompanyId(targeting.companyId);
    setBranchId(targeting.branchId);
    setPendingFile(null);
    setRemoveImage(false);
    setPreviewUrl(row.image_url);
    if (fileRef.current) fileRef.current.value = "";
    setOpen(true);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    if (!announcementImageExt(file.type)) {
      toast.error(t("platformAnnouncements.unsupportedFormat"));
      return;
    }
    if (file.size > PLATFORM_ANNOUNCEMENT_IMAGE_MAX_BYTES) {
      toast.error(t("platformAnnouncements.fileTooLarge"));
      return;
    }
    setPendingFile(file);
    setRemoveImage(false);
    setPreviewUrl((prev) => {
      revokePreview(prev);
      return URL.createObjectURL(file);
    });
  }

  async function uploadImage(file: File): Promise<string> {
    const ext = announcementImageExt(file.type);
    if (!ext) throw new Error(t("platformAnnouncements.unsupportedFormat"));
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(PLATFORM_ANNOUNCEMENT_IMAGE_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw new Error(error.message);
    return path;
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      let uploadedPath: string | null = null;
      try {
        if (pendingFile) {
          uploadedPath = await uploadImage(pendingFile);
        }
        const imagePath = pendingFile
          ? uploadedPath
          : removeImage
            ? null
            : (editing?.image_path ?? null);
        const payload = {
          title,
          body,
          scope,
          companyId: scope === "all" ? null : companyId || null,
          branchId: scope === "branch" ? branchId || null : null,
          imagePath,
        };
        if (editing) {
          return await updateFn({ data: { id: editing.id, ...payload } });
        }
        return await createFn({ data: payload });
      } catch (error) {
        if (uploadedPath) {
          await supabase.storage
            .from(PLATFORM_ANNOUNCEMENT_IMAGE_BUCKET)
            .remove([uploadedPath])
            .catch(() => {});
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["platform-announcements-visible"] });
      toast.success(
        editing ? t("platformAnnouncements.updated") : t("platformAnnouncements.created"),
      );
      handleOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["platform-announcements-visible"] });
      toast.success(t("platformAnnouncements.deleted"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function scopeLabel(row: { company_id: string | null; branch_id: string | null }) {
    if (row.branch_id) {
      const branch = (branchesQ.data ?? []).find(
        (b) => b.sourceBranchId === row.branch_id || b.id === row.branch_id,
      );
      const company = companies.find((c) => c.id === row.company_id);
      return t("platformAnnouncements.scopeBranchValue", {
        company: company?.name ?? row.company_id,
        branch: branch?.name ?? row.branch_id,
      });
    }
    if (row.company_id) {
      const company = companies.find((c) => c.id === row.company_id);
      return t("platformAnnouncements.scopeCompanyValue", {
        company: company?.name ?? row.company_id,
      });
    }
    return t("platformAnnouncements.scopeAll");
  }

  const showPreview = !!previewUrl && !removeImage;
  const saveDisabled =
    saveMut.isPending ||
    !title.trim() ||
    !body.trim() ||
    (scope === "company" && !companyId) ||
    (scope === "branch" && (!companyId || !branchId));

  if (!flags.isLoading && !flags.announcements) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <div className="size-12 rounded-xl bg-muted flex items-center justify-center">
          <Megaphone className="size-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">{t("platformAnnouncements.disabledTitle")}</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("platformAnnouncements.disabledDesc")}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/platform/feature-flags">{t("maintenancePage.openFeatureFlags")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Megaphone className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="break-words text-2xl sm:text-3xl font-bold">
              {t("platformAnnouncements.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("platformAnnouncements.subtitle")}
            </p>
          </div>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="size-4" />
          {t("platformAnnouncements.new")}
        </Button>
      </header>

      <Card className="card-elevated overflow-hidden">
        {listQ.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            {t("platformAnnouncements.loading")}
          </div>
        ) : (listQ.data ?? []).length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            {t("platformAnnouncements.empty")}
          </div>
        ) : (
          <ul className="divide-y">
            {(listQ.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{row.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                    {row.body}
                  </p>
                  {row.image_url && (
                    <button
                      type="button"
                      className="mt-2 block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        setLightbox({
                          url: row.image_url!,
                          alt: t("platformAnnouncements.imageAlt"),
                        })
                      }
                      aria-label={t("platformAnnouncements.viewImage")}
                    >
                      <img
                        src={row.image_url}
                        alt={t("platformAnnouncements.imageAlt")}
                        className="max-h-28 w-auto rounded-md object-contain"
                      />
                    </button>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {scopeLabel(row)} · {new Date(row.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 self-end gap-1 sm:self-start">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(row)}
                    aria-label={t("common.edit")}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => deleteMut.mutate(row.id)}
                    disabled={deleteMut.isPending}
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("platformAnnouncements.edit") : t("platformAnnouncements.new")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>
              {t("platformAnnouncements.formTitle")}
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Label>
            <Label>
              {t("platformAnnouncements.formBody")}
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
            </Label>
            <div className="space-y-2">
              <Label>{t("platformAnnouncements.formImage")}</Label>
              {showPreview && (
                <img
                  src={previewUrl!}
                  alt={t("platformAnnouncements.imageAlt")}
                  className="max-h-40 w-full rounded-md object-contain bg-muted"
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={PLATFORM_ANNOUNCEMENT_IMAGE_ACCEPT}
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus className="size-4" />
                  {showPreview
                    ? t("platformAnnouncements.replaceImage")
                    : t("platformAnnouncements.pickImage")}
                </Button>
                {showPreview && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      setPendingFile(null);
                      setRemoveImage(true);
                      setPreviewUrl((prev) => {
                        revokePreview(prev);
                        return null;
                      });
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    <ImageOff className="size-4" />
                    {t("platformAnnouncements.removeImage")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("platformAnnouncements.formImageHint")}
              </p>
            </div>
            <Label>
              {t("platformAnnouncements.scope")}
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v as typeof scope);
                  if (v === "all") {
                    setCompanyId("");
                    setBranchId("");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("platformAnnouncements.scopeAll")}</SelectItem>
                  <SelectItem value="company">{t("platformAnnouncements.scopeCompany")}</SelectItem>
                  <SelectItem value="branch">{t("platformAnnouncements.scopeBranch")}</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            {scope !== "all" && (
              <Label>
                {t("platformAnnouncements.scopeCompany")}
                <Select
                  value={companyId}
                  onValueChange={(v) => {
                    setCompanyId(v);
                    setBranchId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("platformAnnouncements.selectCompany")} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}
            {scope === "branch" && (
              <Label>
                {t("platformAnnouncements.scopeBranch")}
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("platformAnnouncements.selectBranch")} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.sourceBranchId} value={b.sourceBranchId}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveDisabled}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lightbox && (
        <ImageLightbox
          images={[{ url: lightbox.url, alt: lightbox.alt }]}
          initialIndex={0}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
