import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fingerprint, Loader2, Trash2 } from "lucide-react";
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
  deleteAttendanceFeatureScope,
  getBranchAttendanceGeo,
  listAttendanceFeatureScopes,
  listAttendanceRolePunchSettings,
  listAttendanceUserGrants,
  listBranchProfilesForAttendanceGrants,
  setAttendanceRolePunch,
  updateBranchAttendanceGeo,
  upsertAttendanceFeatureScope,
  upsertAttendanceUserGrant,
  type AttendancePunchCategory,
} from "@/lib/attendance.functions";

export const Route = createFileRoute("/_authenticated/platform/attendance")({
  component: PlatformAttendancePage,
});

function PlatformAttendancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { companies } = useCompanyContext();

  const listScopesFn = useServerFn(listAttendanceFeatureScopes);
  const upsertScopeFn = useServerFn(upsertAttendanceFeatureScope);
  const deleteScopeFn = useServerFn(deleteAttendanceFeatureScope);
  const listGrantsFn = useServerFn(listAttendanceUserGrants);
  const upsertGrantFn = useServerFn(upsertAttendanceUserGrant);
  const listProfilesFn = useServerFn(listBranchProfilesForAttendanceGrants);
  const getGeoFn = useServerFn(getBranchAttendanceGeo);
  const updateGeoFn = useServerFn(updateBranchAttendanceGeo);
  const listRolePunchFn = useServerFn(listAttendanceRolePunchSettings);
  const setRolePunchFn = useServerFn(setAttendanceRolePunch);

  const [scopeType, setScopeType] = useState<"company" | "branch">("branch");
  const [scopeId, setScopeId] = useState("");

  const [grantBranchId, setGrantBranchId] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [canView, setCanView] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const [geoBranchId, setGeoBranchId] = useState("");
  const [geoLat, setGeoLat] = useState("");
  const [geoLng, setGeoLng] = useState("");
  const [geoRadius, setGeoRadius] = useState("100");

  const branchesQ = useQuery({
    queryKey: ["platform-all-branches"],
    queryFn: () => branchService.listAllBranches(),
  });

  const scopesQ = useQuery({
    queryKey: ["attendance-scopes"],
    queryFn: () => listScopesFn(),
  });
  const grantsQ = useQuery({
    queryKey: ["attendance-grants"],
    queryFn: () => listGrantsFn(),
  });
  const grantProfilesQ = useQuery({
    queryKey: ["attendance-grant-profiles", grantBranchId],
    enabled: !!grantBranchId,
    queryFn: () => listProfilesFn({ data: { branchId: grantBranchId } }),
  });
  const geoQ = useQuery({
    queryKey: ["attendance-geo", geoBranchId],
    enabled: !!geoBranchId,
    queryFn: () => getGeoFn({ data: { branchId: geoBranchId } }),
  });
  const rolePunchQ = useQuery({
    queryKey: ["attendance-role-punch"],
    queryFn: () => listRolePunchFn(),
  });

  const operationalBranches = useMemo(
    () => (branchesQ.data ?? []).filter((b: any) => !!b.sourceBranchId),
    [branchesQ.data],
  );
  const branchOptions = useMemo(
    () =>
      operationalBranches.map((b: any) => ({
        id: String(b.sourceBranchId),
        label: String(b.name ?? b.code ?? b.sourceBranchId),
      })),
    [operationalBranches],
  );
  const companyOptions = useMemo(
    () =>
      (companies ?? []).map((c: any) => ({
        id: String(c.id),
        label: String(c.name ?? c.id),
      })),
    [companies],
  );
  const grantUserOptions = useMemo(
    () =>
      (grantProfilesQ.data ?? []).map((p: any) => ({
        id: String(p.id),
        label: `${p.full_name ?? p.id}${p.id_number ? ` · ${p.id_number}` : ""}`,
      })),
    [grantProfilesQ.data],
  );

  const enableMut = useMutation({
    mutationFn: () =>
      upsertScopeFn({
        data: { scopeType, scopeId, enabled: true },
      }),
    onSuccess: () => {
      toast.success(t("attendance.scopeSaved"));
      void qc.invalidateQueries({ queryKey: ["attendance-scopes"] });
      void qc.invalidateQueries({ queryKey: ["attendance-caps"] });
      setScopeId("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeScopeMut = useMutation({
    mutationFn: (id: string) => deleteScopeFn({ data: { id } }),
    onSuccess: () => {
      toast.success(t("attendance.scopeRemoved"));
      void qc.invalidateQueries({ queryKey: ["attendance-scopes"] });
      void qc.invalidateQueries({ queryKey: ["attendance-caps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveGrantMut = useMutation({
    mutationFn: () =>
      upsertGrantFn({
        data: {
          userId: grantUserId,
          branchId: grantBranchId,
          can_view: canView,
          can_edit: canEdit,
          can_delete: canDelete,
        },
      }),
    onSuccess: () => {
      toast.success(t("attendance.grantSaved"));
      void qc.invalidateQueries({ queryKey: ["attendance-grants"] });
      void qc.invalidateQueries({ queryKey: ["attendance-caps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveGeoMut = useMutation({
    mutationFn: () =>
      updateGeoFn({
        data: {
          branchId: geoBranchId,
          geo_lat: Number(geoLat),
          geo_lng: Number(geoLng),
          geo_radius_m: Number(geoRadius) || 100,
        },
      }),
    onSuccess: () => {
      toast.success(t("attendance.geoSaved"));
      void qc.invalidateQueries({ queryKey: ["attendance-geo", geoBranchId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rolePunchMut = useMutation({
    mutationFn: (args: { category: AttendancePunchCategory; can_punch: boolean }) =>
      setRolePunchFn({ data: args }),
    onSuccess: () => {
      toast.success(t("attendance.rolePunchSaved"));
      void qc.invalidateQueries({ queryKey: ["attendance-role-punch"] });
      void qc.invalidateQueries({ queryKey: ["attendance-caps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!geoQ.data || !geoBranchId) return;
    setGeoLat(geoQ.data.geo_lat != null ? String(geoQ.data.geo_lat) : "");
    setGeoLng(geoQ.data.geo_lng != null ? String(geoQ.data.geo_lng) : "");
    setGeoRadius(String(geoQ.data.geo_radius_m ?? 100));
  }, [geoQ.data, geoBranchId]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Fingerprint className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{t("attendance.platformTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("attendance.platformSubtitle")}</p>
        </div>
      </div>

      <Tabs defaultValue="scopes">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="scopes">{t("attendance.tabScopes")}</TabsTrigger>
          <TabsTrigger value="titles">{t("attendance.tabTitles")}</TabsTrigger>
          <TabsTrigger value="geo">{t("attendance.tabGeo")}</TabsTrigger>
          <TabsTrigger value="grants">{t("attendance.tabGrants")}</TabsTrigger>
        </TabsList>

        <TabsContent value="titles" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t("attendance.rolesHint")}</p>
          <Card className="overflow-hidden p-0">
            {rolePunchQ.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ul className="divide-y">
                {(rolePunchQ.data ?? []).map((row) => (
                  <li
                    key={row.category}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {t(`attendance.punchCategories.${row.category}`)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.can_punch
                          ? t("attendance.titlePunchOn")
                          : t("attendance.titlePunchOff")}
                      </p>
                    </div>
                    <Switch
                      checked={!!row.can_punch}
                      disabled={rolePunchMut.isPending}
                      onCheckedChange={(value) =>
                        rolePunchMut.mutate({
                          category: row.category as AttendancePunchCategory,
                          can_punch: value,
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="scopes" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t("attendance.scopesHint")}</p>
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("attendance.scopeType")}</Label>
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
                    <SelectItem value="branch">{t("attendance.branch")}</SelectItem>
                    <SelectItem value="company">{t("attendance.company")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("attendance.scopeTarget")}</Label>
                <SearchableSingleSelect
                  options={scopeType === "company" ? companyOptions : branchOptions}
                  value={scopeId}
                  onChange={setScopeId}
                  placeholder={t("attendance.choose")}
                />
              </div>
            </div>
            <Button
              onClick={() => enableMut.mutate()}
              disabled={!scopeId || enableMut.isPending}
            >
              {enableMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("attendance.enableFeature")}
            </Button>
          </Card>

          <div className="space-y-2">
            {(scopesQ.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{t("attendance.noScopes")}</p>
            )}
            {(scopesQ.data ?? []).map((s: any) => {
              const label =
                s.branch_id != null
                  ? branchOptions.find((b) => b.id === s.branch_id)?.label ?? s.branch_id
                  : companyOptions.find((c) => c.id === s.company_id)?.label ?? s.company_id;
              return (
                <Card key={s.id} className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.branch_id ? t("attendance.branch") : t("attendance.company")} ·{" "}
                      {s.enabled ? t("attendance.enabled") : t("attendance.disabled")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeScopeMut.mutate(s.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="geo" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t("attendance.geoHint")}</p>
          <Card className="space-y-3 p-4">
            <div className="space-y-1.5">
              <Label>{t("attendance.branch")}</Label>
              <SearchableSingleSelect
                options={branchOptions}
                value={geoBranchId}
                onChange={(v) => {
                  setGeoBranchId(v);
                  setGeoLat("");
                  setGeoLng("");
                  setGeoRadius("100");
                }}
                placeholder={t("attendance.choose")}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("attendance.latitude")}</Label>
                <Input value={geoLat} onChange={(e) => setGeoLat(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("attendance.longitude")}</Label>
                <Input value={geoLng} onChange={(e) => setGeoLng(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("attendance.radiusM")}</Label>
                <Input value={geoRadius} onChange={(e) => setGeoRadius(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <Button
              onClick={() => saveGeoMut.mutate()}
              disabled={
                !geoBranchId ||
                !geoLat ||
                !geoLng ||
                saveGeoMut.isPending ||
                Number.isNaN(Number(geoLat)) ||
                Number.isNaN(Number(geoLng))
              }
            >
              {saveGeoMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("attendance.saveGeo")}
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="grants" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t("attendance.grantsHint")}</p>
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("attendance.branch")}</Label>
                <SearchableSingleSelect
                  options={branchOptions}
                  value={grantBranchId}
                  onChange={(v) => {
                    setGrantBranchId(v);
                    setGrantUserId("");
                  }}
                  placeholder={t("attendance.choose")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("attendance.user")}</Label>
                <SearchableSingleSelect
                  options={grantUserOptions}
                  value={grantUserId}
                  onChange={setGrantUserId}
                  disabled={!grantBranchId}
                  placeholder={t("attendance.choose")}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={canView} onCheckedChange={setCanView} />
                {t("attendance.canView")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={canEdit} onCheckedChange={setCanEdit} />
                {t("attendance.canEdit")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={canDelete} onCheckedChange={setCanDelete} />
                {t("attendance.canDelete")}
              </label>
            </div>
            <Button
              onClick={() => saveGrantMut.mutate()}
              disabled={!grantBranchId || !grantUserId || saveGrantMut.isPending}
            >
              {saveGrantMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("attendance.saveGrant")}
            </Button>
          </Card>

          <div className="space-y-2">
            {(grantsQ.data ?? []).map((g: any) => {
              const branchLabel =
                branchOptions.find((b) => b.id === g.branch_id)?.label ?? g.branch_id;
              return (
                <Card key={g.id} className="p-3 text-sm">
                  <p className="font-medium">
                    {g.full_name ?? g.user_id}
                    {g.id_number ? ` · ${g.id_number}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {branchLabel} ·{" "}
                    {[
                      g.can_view ? t("attendance.canView") : null,
                      g.can_edit ? t("attendance.canEdit") : null,
                      g.can_delete ? t("attendance.canDelete") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
