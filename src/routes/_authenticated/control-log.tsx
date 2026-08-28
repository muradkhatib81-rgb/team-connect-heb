import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useAuth } from "@/lib/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { opsErrorTypeLabel } from "@/lib/ops-error-type-label";
import { intlLocaleForApp } from "@/lib/app-locale";
import {
  createOpsErrorEntry,
  deleteOpsErrorEntry,
  getOpsErrorCapabilities,
  listBranchDepartmentsForErrors,
  listDepartmentEmployeesForErrors,
  listOpsErrorEntries,
  listOpsErrorTypes,
} from "@/lib/ops-errors.functions";

const OPS_ERROR_IMAGE_BUCKET = "ops-error-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const Route = createFileRoute("/_authenticated/control-log")({
  component: OpsErrorsPage,
  validateSearch: (s: Record<string, unknown>) => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
});

function OpsErrorsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const branchId = activeBranchId ?? profile?.branch_id ?? null;
  const search = Route.useSearch();
  const defaultTab = search.tab === "log" ? "log" : "create";
  const fileRef = useRef<HTMLInputElement>(null);

  const capsFn = useServerFn(getOpsErrorCapabilities);
  const typesFn = useServerFn(listOpsErrorTypes);
  const deptsFn = useServerFn(listBranchDepartmentsForErrors);
  const empsFn = useServerFn(listDepartmentEmployeesForErrors);
  const listFn = useServerFn(listOpsErrorEntries);
  const createFn = useServerFn(createOpsErrorEntry);
  const deleteFn = useServerFn(deleteOpsErrorEntry);

  const [departmentId, setDepartmentId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [errorTypeId, setErrorTypeId] = useState("");
  const [note, setNote] = useState("");
  const [yearMonth, setYearMonth] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const capsQ = useQuery({
    queryKey: ["ops-error-caps", branchId],
    enabled: !!branchId,
    queryFn: () => capsFn({ data: { branchId: branchId! } }),
  });

  const caps = capsQ.data;
  const ym = yearMonth || caps?.year_month || "";

  const typesQ = useQuery({
    queryKey: ["ops-error-types-active"],
    enabled: !!caps?.enabled,
    queryFn: () => typesFn(),
  });

  const deptsQ = useQuery({
    queryKey: ["ops-error-depts", branchId],
    enabled: !!branchId && !!caps?.can_log,
    queryFn: () => deptsFn({ data: { branchId: branchId! } }),
  });

  const empsQ = useQuery({
    queryKey: ["ops-error-emps", departmentId],
    enabled: !!departmentId && !!caps?.can_log,
    queryFn: () => empsFn({ data: { departmentId } }),
  });

  const entriesQ = useQuery({
    queryKey: ["ops-error-entries", branchId, ym],
    enabled: !!branchId && !!ym && !!caps?.show_card,
    queryFn: () =>
      listFn({
        data: { branchId: branchId!, yearMonth: ym },
      }),
  });

  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("opsErrors.imageTypeError"));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t("opsErrors.imageSizeError"));
      return;
    }
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!branchId || !profile?.id) throw new Error(t("opsErrors.needBranch"));
      let imagePath: string | null = null;
      if (imageFile) {
        const ext = (imageFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        imagePath = `${profile.id}/${crypto.randomUUID()}.${ext || "jpg"}`;
        const { error: upErr } = await supabase.storage
          .from(OPS_ERROR_IMAGE_BUCKET)
          .upload(imagePath, imageFile, { contentType: imageFile.type, upsert: false });
        if (upErr) throw upErr;
      }
      try {
        return await createFn({
          data: {
            branchId,
            departmentId,
            employeeId: employeeId && employeeId !== "__dept__" ? employeeId : null,
            errorTypeId,
            note: note || null,
            imagePath,
          },
        });
      } catch (e) {
        if (imagePath) {
          await supabase.storage.from(OPS_ERROR_IMAGE_BUCKET).remove([imagePath]).catch(() => {});
        }
        throw e;
      }
    },
    onSuccess: () => {
      toast.success(t("opsErrors.created"));
      setNote("");
      setErrorTypeId("");
      clearImage();
      void qc.invalidateQueries({ queryKey: ["ops-error-entries"] });
      void qc.invalidateQueries({ queryKey: ["ops-error-caps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(t("opsErrors.deleted"));
      void qc.invalidateQueries({ queryKey: ["ops-error-entries"] });
      void qc.invalidateQueries({ queryKey: ["ops-error-caps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dateLocale = intlLocaleForApp(i18n.language);

  const typeLabel = (ty: {
    name_he: string;
    name_ar: string | null;
    name_en: string | null;
  }) => opsErrorTypeLabel(ty, i18n.language);

  const entryTypeLabel = (e: {
    type_name_he?: string | null;
    type_name_ar?: string | null;
    type_name_en?: string | null;
  }) =>
    opsErrorTypeLabel(
      {
        name_he: e.type_name_he ?? "",
        name_ar: e.type_name_ar ?? null,
        name_en: e.type_name_en ?? null,
      },
      i18n.language,
    );

  const monthOptions = useMemo(() => {
    const now = caps?.year_month;
    if (!now) return [];
    const [y, m] = now.split("-").map(Number);
    const opts: string[] = [];
    for (let i = 0; i < 12; i++) {
      let mm = m - i;
      let yy = y;
      while (mm <= 0) {
        mm += 12;
        yy -= 1;
      }
      opts.push(`${yy}-${String(mm).padStart(2, "0")}`);
    }
    return opts;
  }, [caps?.year_month]);

  if (!branchId) {
    return <p className="p-6 text-sm text-muted-foreground">{t("opsErrors.needBranch")}</p>;
  }

  if (capsQ.isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!caps?.enabled || !caps.show_card) {
    return (
      <div className="p-6 space-y-2">
        <h1 className="text-xl font-bold">{t("opsErrors.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("opsErrors.notAvailable")}</p>
      </div>
    );
  }

  const showCreate = caps.can_log;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
          <AlertTriangle className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("opsErrors.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("opsErrors.monthLabel")}: {caps.year_month}
          </p>
        </div>
      </header>

      <Tabs defaultValue={showCreate ? defaultTab : "log"}>
        <TabsList>
          {showCreate && <TabsTrigger value="create">{t("opsErrors.tabCreate")}</TabsTrigger>}
          <TabsTrigger value="log">{t("opsErrors.tabLog")}</TabsTrigger>
        </TabsList>

        {showCreate && (
          <TabsContent value="create" className="mt-4">
            <Card className="p-4 space-y-3">
              <div>
                <Label>{t("opsErrors.department")}</Label>
                <Select
                  value={departmentId}
                  onValueChange={(v) => {
                    setDepartmentId(v);
                    setEmployeeId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("opsErrors.choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(deptsQ.data ?? []).map((d: { id: string; name: string }) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("opsErrors.employeeOptional")}</Label>
                <Select
                  value={employeeId || "__dept__"}
                  onValueChange={setEmployeeId}
                  disabled={!departmentId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("opsErrors.deptOnly")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__dept__">{t("opsErrors.deptOnly")}</SelectItem>
                    {(empsQ.data ?? []).map((e: { id: string; full_name: string | null }) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("opsErrors.errorType")}</Label>
                <Select value={errorTypeId} onValueChange={setErrorTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("opsErrors.choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(typesQ.data ?? []).map((ty) => (
                      <SelectItem key={ty.id} value={ty.id}>
                        {typeLabel(ty)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("opsErrors.reason")}</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("opsErrors.reasonPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("opsErrors.imageOptional")}</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
                />
                {imagePreview ? (
                  <div className="relative inline-block">
                    <img
                      src={imagePreview}
                      alt=""
                      className="h-28 w-28 rounded-lg object-cover border"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="absolute -top-2 -right-2 size-7 rounded-full"
                      onClick={clearImage}
                      aria-label={t("opsErrors.removeImage")}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus className="size-4" />
                    {t("opsErrors.addImage")}
                  </Button>
                )}
              </div>
              <Button
                disabled={!departmentId || !errorTypeId || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {t("opsErrors.submit")}
              </Button>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="log" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm">{t("opsErrors.monthLabel")}</Label>
            <Select value={ym} onValueChange={setYearMonth}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(entriesQ.data ?? []).map((e) => (
            <Card key={e.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                  <p className="font-semibold text-base">{entryTypeLabel(e)}</p>
                  <p>
                    <span className="text-muted-foreground">{t("opsErrors.department")}: </span>
                    {e.department_name ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">{t("opsErrors.employee")}: </span>
                    {e.employee_name ?? t("opsErrors.deptOnly")}
                  </p>
                  <p>
                    <span className="text-muted-foreground">{t("opsErrors.loggedAt")}: </span>
                    {new Date(e.created_at).toLocaleString(dateLocale)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">{t("opsErrors.loggedBy")}: </span>
                    {e.creator_name ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">{t("opsErrors.reason")}: </span>
                    {e.note?.trim() ? e.note : t("opsErrors.noReason")}
                  </p>
                  {e.image_url ? (
                    <button
                      type="button"
                      className="mt-1 block"
                      onClick={() => setLightboxUrl(e.image_url!)}
                    >
                      <img
                        src={e.image_url}
                        alt=""
                        className="h-24 w-24 rounded-lg object-cover border hover:opacity-90"
                      />
                    </button>
                  ) : null}
                </div>
                {caps.can_delete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMut.mutate(e.id)}
                    aria-label={t("opsErrors.delete")}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            </Card>
          ))}

          {!entriesQ.isLoading && !(entriesQ.data ?? []).length && (
            <p className="text-sm text-muted-foreground">{t("opsErrors.emptyLog")}</p>
          )}
        </TabsContent>
      </Tabs>

      {lightboxUrl ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightboxUrl(null)}
          aria-label={t("opsErrors.closeImage")}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
          />
        </button>
      ) : null}
    </div>
  );
}
