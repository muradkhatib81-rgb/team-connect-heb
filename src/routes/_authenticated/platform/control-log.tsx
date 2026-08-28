import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSingleSelect } from "@/components/searchable-picker";
import { useCompanyContext } from "@/platform";
import { branchService } from "@/modules/branches";
import {
  deleteOpsErrorFeatureScope,
  listAllOpsErrorTypes,
  listBranchProfilesForErrorGrants,
  listOpsErrorFeatureScopes,
  listOpsErrorUserGrants,
  upsertOpsErrorFeatureScope,
  upsertOpsErrorType,
  upsertOpsErrorUserGrant,
} from "@/lib/ops-errors.functions";
import {
  localeKeyFromLanguage,
  opsErrorTypeLabel,
  opsErrorTypeNamesFromRow,
  opsErrorTypePayloadFromNames,
  type OpsErrorTypeLocale,
} from "@/lib/ops-error-type-label";

export const Route = createFileRoute("/_authenticated/platform/control-log")({
  component: PlatformOpsErrorsPage,
});

function PlatformOpsErrorsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { companies } = useCompanyContext();
  const activeLocale = localeKeyFromLanguage(i18n.language);

  const listTypesFn = useServerFn(listAllOpsErrorTypes);
  const upsertTypeFn = useServerFn(upsertOpsErrorType);
  const listScopesFn = useServerFn(listOpsErrorFeatureScopes);
  const upsertScopeFn = useServerFn(upsertOpsErrorFeatureScope);
  const deleteScopeFn = useServerFn(deleteOpsErrorFeatureScope);
  const listGrantsFn = useServerFn(listOpsErrorUserGrants);
  const upsertGrantFn = useServerFn(upsertOpsErrorUserGrant);
  const listProfilesFn = useServerFn(listBranchProfilesForErrorGrants);

  const [typeNames, setTypeNames] = useState<Record<OpsErrorTypeLocale, string>>({
    he: "",
    ar: "",
    en: "",
  });
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);

  const [scopeType, setScopeType] = useState<"company" | "branch">("branch");
  const [scopeId, setScopeId] = useState("");

  const [grantBranchId, setGrantBranchId] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [canLog, setCanLog] = useState(true);
  const [canView, setCanView] = useState(true);
  const [canDelete, setCanDelete] = useState(false);

  const branchesQ = useQuery({
    queryKey: ["platform-all-branches"],
    queryFn: () => branchService.listAllBranches(),
  });

  const typesQ = useQuery({
    queryKey: ["ops-error-types-all"],
    queryFn: () => listTypesFn(),
  });
  const scopesQ = useQuery({
    queryKey: ["ops-error-scopes"],
    queryFn: () => listScopesFn(),
  });
  const grantsQ = useQuery({
    queryKey: ["ops-error-grants"],
    queryFn: () => listGrantsFn({ data: {} }),
  });
  const profilesQ = useQuery({
    queryKey: ["ops-error-grant-profiles", grantBranchId],
    enabled: !!grantBranchId,
    queryFn: () => listProfilesFn({ data: { branchId: grantBranchId } }),
  });

  const companyMap = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );
  /** Operational `public.branches.id` — assignment `id` is not a valid FK target. */
  const operationalBranches = useMemo(
    () => (branchesQ.data ?? []).filter((b) => !!b.sourceBranchId),
    [branchesQ.data],
  );
  const branchMap = useMemo(
    () => new Map(operationalBranches.map((b) => [b.sourceBranchId, b.name])),
    [operationalBranches],
  );
  const companyOptions = useMemo(
    () => companies.map((c) => ({ id: c.id, label: c.name })),
    [companies],
  );
  const branchOptions = useMemo(
    () => operationalBranches.map((b) => ({ id: b.sourceBranchId, label: b.name })),
    [operationalBranches],
  );
  const grantUserOptions = useMemo(
    () => (profilesQ.data ?? []).map((p) => ({ id: p.id, label: p.full_name ?? p.id })),
    [profilesQ.data],
  );
  const scopeTargetOptions = scopeType === "company" ? companyOptions : branchOptions;
  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profilesQ.data ?? []) {
      m.set(p.id, p.full_name ?? p.id);
    }
    return m;
  }, [profilesQ.data]);

  const hasAnyTypeName =
    !!typeNames.he.trim() || !!typeNames.ar.trim() || !!typeNames.en.trim();

  const saveTypeMut = useMutation({
    mutationFn: () => upsertTypeFn({ data: opsErrorTypePayloadFromNames(typeNames, editingTypeId ?? undefined) }),
    onSuccess: () => {
      toast.success(t("opsErrors.typeSaved"));
      setTypeNames({ he: "", ar: "", en: "" });
      setEditingTypeId(null);
      void qc.invalidateQueries({ queryKey: ["ops-error-types-all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveScopeMut = useMutation({
    mutationFn: () =>
      upsertScopeFn({
        data: { scopeType, scopeId, enabled: true },
      }),
    onSuccess: () => {
      toast.success(t("opsErrors.scopeSaved"));
      setScopeId("");
      void qc.invalidateQueries({ queryKey: ["ops-error-scopes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScopeMut = useMutation({
    mutationFn: (id: string) => deleteScopeFn({ data: { id } }),
    onSuccess: () => {
      toast.success(t("opsErrors.scopeRemoved"));
      void qc.invalidateQueries({ queryKey: ["ops-error-scopes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveGrantMut = useMutation({
    mutationFn: () =>
      upsertGrantFn({
        data: {
          userId: grantUserId,
          branchId: grantBranchId,
          can_log: canLog,
          can_view_log: canView,
          can_delete: canDelete,
        },
      }),
    onSuccess: () => {
      toast.success(t("opsErrors.grantSaved"));
      void qc.invalidateQueries({ queryKey: ["ops-error-grants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTypeMut = useMutation({
    mutationFn: (row: {
      id: string;
      is_active: boolean;
      name_he: string;
      name_ar: string | null;
      name_en: string | null;
    }) =>
      upsertTypeFn({
        data: {
          id: row.id,
          name_he: row.name_he,
          name_ar: row.name_ar,
          name_en: row.name_en,
          is_active: !row.is_active,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ops-error-types-all"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
          <AlertTriangle className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("opsErrors.platformTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("opsErrors.platformSubtitle")}</p>
        </div>
      </header>

      <Tabs defaultValue="scopes">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="scopes">{t("opsErrors.tabScopes")}</TabsTrigger>
          <TabsTrigger value="types">{t("opsErrors.tabTypes")}</TabsTrigger>
          <TabsTrigger value="grants">{t("opsErrors.tabGrants")}</TabsTrigger>
        </TabsList>

        <TabsContent value="scopes" className="space-y-4 mt-4">
          <Card className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">{t("opsErrors.scopesHint")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>{t("opsErrors.scopeType")}</Label>
                <Select
                  value={scopeType}
                  onValueChange={(v) => {
                    setScopeType(v as "company" | "branch");
                    setScopeId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">{t("opsErrors.company")}</SelectItem>
                    <SelectItem value="branch">{t("opsErrors.branch")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>{t("opsErrors.scopeTarget")}</Label>
                <SearchableSingleSelect
                  options={scopeTargetOptions}
                  value={scopeId}
                  onChange={setScopeId}
                  placeholder={t("opsErrors.choose")}
                  searchPlaceholder={t("common.searchPlaceholder")}
                  emptyText={t("common.noResults")}
                />
              </div>
            </div>
            <Button
              disabled={!scopeId || saveScopeMut.isPending}
              onClick={() => saveScopeMut.mutate()}
            >
              {saveScopeMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t("opsErrors.enableFeature")}
            </Button>
          </Card>

          <div className="space-y-2">
            {(scopesQ.data ?? []).map((s: any) => (
              <Card key={s.id} className="p-3 flex items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-medium">
                    {s.company_id
                      ? `${t("opsErrors.company")}: ${companyMap.get(s.company_id) ?? s.company_id}`
                      : `${t("opsErrors.branch")}: ${branchMap.get(s.branch_id) ?? s.branch_id}`}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {s.enabled ? t("opsErrors.enabled") : t("opsErrors.disabled")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteScopeMut.mutate(s.id)}
                  aria-label={t("opsErrors.remove")}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </Card>
            ))}
            {!scopesQ.isLoading && !(scopesQ.data ?? []).length && (
              <p className="text-sm text-muted-foreground">{t("opsErrors.noScopes")}</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="types" className="space-y-4 mt-4">
          <Card className="p-4 space-y-3">
            <div>
              <Label>{t("opsErrors.typeName")}</Label>
              <Input
                value={typeNames[activeLocale]}
                onChange={(e) =>
                  setTypeNames((prev) => ({ ...prev, [activeLocale]: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
            <Button
              disabled={!hasAnyTypeName || saveTypeMut.isPending}
              onClick={() => saveTypeMut.mutate()}
            >
                {saveTypeMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {editingTypeId ? t("opsErrors.saveType") : t("opsErrors.addType")}
              </Button>
              {editingTypeId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingTypeId(null);
                    setTypeNames({ he: "", ar: "", en: "" });
                  }}
                >
                  {t("common.cancel")}
                </Button>
              )}
            </div>
          </Card>
          <div className="space-y-2">
            {(typesQ.data ?? []).map((row) => (
              <Card
                key={row.id}
                className={`p-3 flex items-center justify-between gap-2 cursor-pointer transition-colors hover:bg-muted/40 ${
                  editingTypeId === row.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => {
                  setEditingTypeId(row.id);
                  setTypeNames(opsErrorTypeNamesFromRow(row));
                }}
              >
                <div>
                  <p className="font-medium text-sm">{opsErrorTypeLabel(row, i18n.language)}</p>
                </div>
                <div
                  className="flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-muted-foreground">
                    {row.is_active ? t("opsErrors.active") : t("opsErrors.inactive")}
                  </span>
                  <Switch
                    checked={row.is_active}
                    onCheckedChange={() => toggleTypeMut.mutate(row)}
                  />
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="grants" className="space-y-4 mt-4">
          <Card className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">{t("opsErrors.grantsHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("opsErrors.branch")}</Label>
                <SearchableSingleSelect
                  options={branchOptions}
                  value={grantBranchId}
                  onChange={(id) => {
                    setGrantBranchId(id);
                    setGrantUserId("");
                  }}
                  placeholder={t("opsErrors.choose")}
                  searchPlaceholder={t("common.searchPlaceholder")}
                  emptyText={t("common.noResults")}
                />
              </div>
              <div>
                <Label>{t("opsErrors.user")}</Label>
                <SearchableSingleSelect
                  options={grantUserOptions}
                  value={grantUserId}
                  onChange={setGrantUserId}
                  disabled={!grantBranchId}
                  placeholder={t("opsErrors.choose")}
                  searchPlaceholder={t("common.searchPlaceholder")}
                  emptyText={t("common.noResults")}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={canLog} onCheckedChange={setCanLog} />
                {t("opsErrors.canLog")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={canView} onCheckedChange={setCanView} />
                {t("opsErrors.canViewLog")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={canDelete} onCheckedChange={setCanDelete} />
                {t("opsErrors.canDelete")}
              </label>
            </div>
            <Button
              disabled={!grantBranchId || !grantUserId || saveGrantMut.isPending}
              onClick={() => saveGrantMut.mutate()}
            >
              {t("opsErrors.saveGrant")}
            </Button>
          </Card>

          <div className="space-y-2">
            {(grantsQ.data ?? []).map((g: any) => (
              <Card key={g.id} className="p-3 text-sm">
                <p className="font-medium">
                  {profileMap.get(g.user_id) ?? g.user_id.slice(0, 8)}
                  {" · "}
                  {branchMap.get(g.branch_id) ?? g.branch_id.slice(0, 8)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {[
                    g.can_log ? t("opsErrors.canLog") : null,
                    g.can_view_log ? t("opsErrors.canViewLog") : null,
                    g.can_delete ? t("opsErrors.canDelete") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
