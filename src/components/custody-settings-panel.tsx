import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import {
  custodySettingsQueryKey,
  fetchCustodyBranchSettings,
  fetchCustodyItemTypes,
  fetchCustodyUserCaps,
  invalidateCustodyQueries,
  suggestNextEquipmentName,
  type CustodyItemTypeRow,
  upsertCustodyBranchSettings,
  upsertCustodyItemType,
} from "@/lib/custody-workflow";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  branchId: string;
  userId: string;
  /** When embedded in a dialog, hide outer titles if needed */
  compact?: boolean;
};

export function CustodySettingsPanel({ branchId, userId, compact }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const capsQ = useQuery({
    queryKey: ["custody-caps", userId],
    queryFn: () => fetchCustodyUserCaps(userId),
  });

  const typesQ = useQuery({
    enabled: !!capsQ.data && (capsQ.data.canCreate || capsQ.data.canEdit || capsQ.data.canDelete),
    queryKey: [...custodySettingsQueryKey(branchId), "types"],
    queryFn: () => fetchCustodyItemTypes(branchId),
  });

  const settingsQ = useQuery({
    enabled: !!capsQ.data?.canConfigure,
    queryKey: [...custodySettingsQueryKey(branchId), "branch"],
    queryFn: () => fetchCustodyBranchSettings(branchId),
  });

  useEffect(() => {
    const ch = supabase
      .channel(`custody-settings-${branchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "custody_item_types",
          filter: `branch_id=eq.${branchId}`,
        },
        () => qc.invalidateQueries({ queryKey: custodySettingsQueryKey(branchId) }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "custody_branch_settings",
          filter: `branch_id=eq.${branchId}`,
        },
        () => qc.invalidateQueries({ queryKey: custodySettingsQueryKey(branchId) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [branchId, qc]);

  const [editRow, setEditRow] = useState<CustodyItemTypeRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<CustodyItemTypeRow | null>(null);

  const [branchForm, setBranchForm] = useState({
    default_employee_reminder_minutes: 60,
    manager_midnight_warning_minutes: 60,
    daily_log_reset_hours: 24,
  });

  useEffect(() => {
    if (settingsQ.data) {
      setBranchForm({
        default_employee_reminder_minutes: settingsQ.data.default_employee_reminder_minutes,
        manager_midnight_warning_minutes: settingsQ.data.manager_midnight_warning_minutes,
        daily_log_reset_hours: settingsQ.data.daily_log_reset_hours,
      });
    }
  }, [settingsQ.data]);

  const saveTypeMut = useMutation({
    mutationFn: upsertCustodyItemType,
    onSuccess: () => {
      toast.success(t("custody.saved"));
      setEditRow(null);
      setCreateOpen(false);
      invalidateCustodyQueries(qc, branchId, userId);
    },
    onError: (e: Error) => toast.error(e.message ?? t("common.error")),
  });

  const reorderMut = useMutation({
    mutationFn: async (rows: CustodyItemTypeRow[]) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sort_order = i + 1;
        if (row.sort_order === sort_order) continue;
        await upsertCustodyItemType({
          branchId,
          id: row.id,
          name: row.name,
          sort_order,
          is_active: row.is_active,
          employee_reminder_minutes: row.employee_reminder_minutes,
        });
      }
    },
    onSuccess: () => invalidateCustodyQueries(qc, branchId, userId),
    onError: (e: Error) => toast.error(e.message ?? t("common.error")),
  });

  const deactivateMut = useMutation({
    mutationFn: async (row: CustodyItemTypeRow) => {
      await upsertCustodyItemType({
        branchId,
        id: row.id,
        name: row.name,
        sort_order: row.sort_order,
        is_active: false,
        employee_reminder_minutes: row.employee_reminder_minutes,
      });
    },
    onSuccess: () => {
      toast.success(t("custody.equipmentDeactivated"));
      setDeactivateTarget(null);
      invalidateCustodyQueries(qc, branchId, userId);
    },
    onError: (e: Error) => toast.error(e.message ?? t("common.error")),
  });

  const saveBranchMut = useMutation({
    mutationFn: () =>
      upsertCustodyBranchSettings({
        branchId,
        default_employee_reminder_minutes: branchForm.default_employee_reminder_minutes,
        manager_midnight_warning_minutes: branchForm.manager_midnight_warning_minutes,
        daily_log_reset_hours: branchForm.daily_log_reset_hours,
      }),
    onSuccess: () => {
      toast.success(t("custody.branchSettingsSaved"));
      qc.invalidateQueries({ queryKey: custodySettingsQueryKey(branchId) });
    },
    onError: (e: Error) => toast.error(e.message ?? t("common.error")),
  });

  const caps = capsQ.data;
  if (capsQ.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!caps?.canOpenSettings) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {t("custody.settingsNoPermission")}
      </p>
    );
  }

  const canManageItems = caps.canCreate || caps.canEdit || caps.canDelete;

  const activeRows = (typesQ.data ?? []).filter((r) => r.is_active);
  const inactiveRows = (typesQ.data ?? []).filter((r) => !r.is_active);

  function move(idx: number, dir: -1 | 1) {
    const arr = [...activeRows];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorderMut.mutate(arr);
  }

  return (
    <div className="space-y-8">
      {!compact && (
        <div>
          <h2 className="text-lg font-bold">{t("custody.settingsPanelTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("custody.settingsPanelSubtitle")}
          </p>
        </div>
      )}

      {canManageItems && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold">{t("custody.itemsTitle")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("custody.itemsHint")}
              </p>
            </div>
            {caps.canCreate && (
              <Button
                size="sm"
                className="gap-2"
                onClick={() => {
                  setEditRow(null);
                  setCreateOpen(true);
                }}
              >
                <Plus className="size-4" />
                {t("custody.addEquipment")}
              </Button>
            )}
          </div>

          {typesQ.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : activeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-lg p-4 text-center">
              {caps.canCreate
                ? t("custody.noEquipmentCreate")
                : t("custody.noEquipmentBranch")}
            </p>
          ) : (
            <ul className="space-y-2">
              {activeRows.map((row, idx) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2 border rounded-lg p-3 bg-card"
                >
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="font-medium truncate">{row.name}</span>
                    {row.employee_reminder_minutes != null && (
                      <span className="text-xs text-muted-foreground">
                        {t("custody.reminderMins", { minutes: row.employee_reminder_minutes })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {caps.canEdit && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={idx === 0 || reorderMut.isPending}
                          onClick={() => move(idx, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={idx === activeRows.length - 1 || reorderMut.isPending}
                          onClick={() => move(idx, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => {
                            setCreateOpen(false);
                            setEditRow(row);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </>
                    )}
                    {caps.canDelete && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeactivateTarget(row)}
                      >
                        {t("custody.deactivate")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {inactiveRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">{t("custody.deactivated")}</p>
              {inactiveRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 border border-dashed rounded-lg p-3 opacity-70"
                >
                  <span>{row.name}</span>
                  {caps.canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        saveTypeMut.mutate({
                          branchId,
                          id: row.id,
                          name: row.name,
                          sort_order: row.sort_order,
                          is_active: true,
                          employee_reminder_minutes: row.employee_reminder_minutes,
                        })
                      }
                    >
                      {t("custody.reactivate")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {caps.canConfigure && (
        <section className="space-y-4 border-t pt-6">
          <div>
            <h3 className="font-semibold">{t("custody.branchSettingsTitle")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("custody.branchSettingsHint")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="custody-reminder">{t("custody.employeeReminderLabel")}</Label>
              <Input
                id="custody-reminder"
                type="number"
                min={1}
                value={branchForm.default_employee_reminder_minutes}
                onChange={(e) =>
                  setBranchForm((f) => ({
                    ...f,
                    default_employee_reminder_minutes: Number(e.target.value) || 1,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custody-midnight">{t("custody.midnightWarningLabel")}</Label>
              <Input
                id="custody-midnight"
                type="number"
                min={1}
                value={branchForm.manager_midnight_warning_minutes}
                onChange={(e) =>
                  setBranchForm((f) => ({
                    ...f,
                    manager_midnight_warning_minutes: Number(e.target.value) || 1,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custody-reset">{t("custody.dailyResetLabel")}</Label>
              <Input
                id="custody-reset"
                type="number"
                min={1}
                value={branchForm.daily_log_reset_hours}
                onChange={(e) =>
                  setBranchForm((f) => ({
                    ...f,
                    daily_log_reset_hours: Number(e.target.value) || 1,
                  }))
                }
              />
            </div>
          </div>

          <Button
            onClick={() => saveBranchMut.mutate()}
            disabled={saveBranchMut.isPending}
            className="gap-2"
          >
            {saveBranchMut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("custody.saveBranchSettings")}
          </Button>
        </section>
      )}

      <ItemTypeDialog
        open={createOpen || !!editRow}
        title={editRow ? t("custody.editEquipment") : t("custody.newEquipment")}
        initial={
          editRow ?? {
            id: "",
            name: suggestNextEquipmentName(typesQ.data ?? []),
            sort_order: activeRows.length + 1,
            is_active: true,
            employee_reminder_minutes: null,
          }
        }
        isCreate={!editRow}
        busy={saveTypeMut.isPending}
        onClose={() => {
          setCreateOpen(false);
          setEditRow(null);
        }}
        onSave={(values) =>
          saveTypeMut.mutate({
            branchId,
            id: editRow?.id,
            name: values.name,
            sort_order: editRow?.sort_order ?? activeRows.length + 1,
            is_active: values.is_active,
            employee_reminder_minutes: values.useCustomReminder
              ? values.employee_reminder_minutes
              : null,
          })
        }
      />

      <AlertDialog open={!!deactivateTarget} onOpenChange={() => setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("custody.deactivateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("custody.deactivateDesc", { name: deactivateTarget?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivateTarget && deactivateMut.mutate(deactivateTarget)}
            >
              {t("custody.deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ItemTypeDialog({
  open,
  title,
  initial,
  isCreate,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: CustodyItemTypeRow;
  isCreate: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (v: {
    name: string;
    is_active: boolean;
    useCustomReminder: boolean;
    employee_reminder_minutes: number;
  }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [isActive, setIsActive] = useState(initial.is_active);
  const [useCustomReminder, setUseCustomReminder] = useState(
    initial.employee_reminder_minutes != null,
  );
  const [reminderMins, setReminderMins] = useState(
    initial.employee_reminder_minutes ?? 60,
  );

  useEffect(() => {
    if (open) {
      setName(initial.name);
      setIsActive(initial.is_active);
      setUseCustomReminder(initial.employee_reminder_minutes != null);
      setReminderMins(initial.employee_reminder_minutes ?? 60);
    }
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="custody-type-name">{t("custody.equipmentNameLabel")}</Label>
            <Input
              id="custody-type-name"
              placeholder={t("custody.equipmentNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {!isCreate && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="custody-type-active">{t("custody.activeLabel")}</Label>
              <Switch id="custody-type-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="custody-custom-reminder">{t("custody.customReminderLabel")}</Label>
            <Switch
              id="custody-custom-reminder"
              checked={useCustomReminder}
              onCheckedChange={setUseCustomReminder}
            />
          </div>
          {useCustomReminder && (
            <Input
              type="number"
              min={1}
              value={reminderMins}
              onChange={(e) => setReminderMins(Number(e.target.value) || 1)}
            />
          )}
          {!useCustomReminder && (
            <Badge variant="secondary" className="text-xs">
              {t("custody.useBranchDefault")}
            </Badge>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                is_active: isActive,
                useCustomReminder,
                employee_reminder_minutes: reminderMins,
              })
            }
          >
            {busy && <Loader2 className="size-4 animate-spin ml-2" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
