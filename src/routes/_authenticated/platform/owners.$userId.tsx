import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Crown,
  ArrowRight,
  Pencil,
  Pause,
  Play,
  Trash2,
  Info,
  CheckCircle2,
  Loader2,
  Activity,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/lib/use-auth";
import {
  suspendPlatformOwner,
  restorePlatformOwner,
  type PlatformOwnerRow,
} from "@/lib/platform-owners.functions";
import {
  usePlatformOwnersQuery,
  usePlatformAuditQuery,
  PLATFORM_AUDIT_KEY,
  PLATFORM_OWNERS_KEY,
  getPlatformEventLabel,
} from "@/lib/platform-owners.hooks";
import {
  PlatformOwnerEditDialog,
  PlatformOwnerDeleteDialog,
} from "@/components/platform/platform-owner-dialogs";
import { ProfilePhoneField } from "@/components/contact-actions";

export const Route = createFileRoute("/_authenticated/platform/owners/$userId")({
  component: PlatformOwnerDetailsPage,
  errorComponent: PlatformOwnerDetailsError,
  notFoundComponent: PlatformOwnerDetailsNotFound,
});

function PlatformOwnerDetailsError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? t("common.error")}
    </div>
  );
}

function PlatformOwnerDetailsNotFound() {
  const { t } = useTranslation();
  return (
    <div className="p-6 text-sm text-muted-foreground">{t("platformOwners.detail.notFound")}</div>
  );
}

function PlatformOwnerDetailsPage() {
  const { t } = useTranslation();
  const { userId } = Route.useParams();
  const { data: profile } = useAuth();
  const isPrimary = !!profile?.roles?.includes("system_admin");
  const navigate = useNavigate();

  const owners = usePlatformOwnersQuery();
  const audit = usePlatformAuditQuery();

  const owner = owners.data?.find((o) => o.user_id === userId) ?? null;

  const events = useMemo(
    () =>
      (audit.data ?? [])
        .filter((e) => e.target_user_id === userId || e.actor_id === userId)
        .slice(0, 10),
    [audit.data, userId],
  );

  if (owners.isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }
  if (!owner) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-2">
          <Link to="/platform/owners">
            <ArrowRight className="size-4" />
            {t("platformOwners.detail.backToList")}
          </Link>
        </Button>
        <Card className="p-8 text-sm text-muted-foreground text-center">
          {t("platformOwners.detail.notFound")}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-2">
        <Link to="/platform/owners">
          <ArrowRight className="size-4" />
          {t("platformOwners.detail.backToList")}
        </Link>
      </Button>

      <OwnerHeader
        owner={owner}
        isPrimary={isPrimary}
        isSelf={profile?.id === owner.user_id}
        onAfterDelete={() => navigate({ to: "/platform/owners" })}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <IdentityCard owner={owner} />
        <StatusCard owner={owner} />
      </div>

      <CapabilitiesCard owner={owner} />

      <Card className="card-elevated">
        <div className="p-4 border-b flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <h2 className="text-base font-semibold">{t("platformOwners.detail.activitySummary")}</h2>
          <Button asChild variant="ghost" size="sm" className="mr-auto">
            <Link to="/platform/audit-log">{t("platformOwners.detail.fullLog")}</Link>
          </Button>
        </div>
        {audit.isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-4 animate-spin text-primary" />
          </div>
        ) : events.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            {t("platformOwners.detail.noActivity")}
          </div>
        ) : (
          <ul className="divide-y">
            {events.map((ev) => (
              <li key={ev.id} className="p-3 text-sm flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-32">
                  {new Date(ev.created_at).toLocaleString("he-IL")}
                </span>
                <span className="font-medium">
                  {getPlatformEventLabel(ev.event)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ev.actor_id === owner.user_id
                    ? t("platformOwners.detail.actor")
                    : t("platformOwners.detail.target")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function OwnerHeader({
  owner,
  isPrimary,
  isSelf,
  onAfterDelete,
}: {
  owner: PlatformOwnerRow;
  isPrimary: boolean;
  isSelf: boolean;
  onAfterDelete: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const suspendFn = useServerFn(suspendPlatformOwner);
  const restoreFn = useServerFn(restorePlatformOwner);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [...PLATFORM_OWNERS_KEY] });
    qc.invalidateQueries({ queryKey: [...PLATFORM_AUDIT_KEY] });
  };
  const suspendMut = useMutation({
    mutationFn: () => suspendFn({ data: { user_id: owner.user_id } }),
    onSuccess: () => { toast.success(t("platformOwners.toasts.suspended")); invalidate(); },
    onError: (e: Error) => toast.error(e.message ?? t("platformOwners.toasts.suspendFailed")),
  });
  const restoreMut = useMutation({
    mutationFn: () => restoreFn({ data: { user_id: owner.user_id } }),
    onSuccess: () => { toast.success(t("platformOwners.toasts.restored")); invalidate(); },
    onError: (e: Error) => toast.error(e.message ?? t("platformOwners.toasts.restoreFailed")),
  });

  const initials = owner.full_name?.trim().charAt(0) || "?";
  const isTargetPrimary = owner.level === "primary";

  return (
    <Card className="card-elevated p-5">
      <div className="flex flex-wrap items-start gap-4">
        <Avatar className="size-16 shrink-0">
          {owner.avatar_url ? <AvatarImage src={owner.avatar_url} alt={owner.full_name} /> : null}
          <AvatarFallback className="text-xl">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{owner.full_name || "—"}</h1>
            {isTargetPrimary && (
              <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400">
                <Crown className="size-3" />
                {t("platformOwners.badges.primaryShort")}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="inline-flex items-center gap-1">
              <Crown className="size-3" />
              {t("platformOwners.detail.businessIdentity")} ·{" "}
              {isTargetPrimary
                ? t("platformOwners.badges.primary")
                : t("platformOwners.badges.owner")}
            </span>
          </p>
        </div>
        {isPrimary && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
              <Pencil className="size-4" />
              {t("platformOwners.actions.edit")}
            </Button>
            {!isTargetPrimary && !isSelf && (
              <>
                {owner.is_active ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={suspendMut.isPending}
                    onClick={() => suspendMut.mutate()}
                    className="gap-2"
                  >
                    <Pause className="size-4" />
                    {t("platformOwners.actions.suspend")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoreMut.isPending}
                    onClick={() => restoreMut.mutate()}
                    className="gap-2"
                  >
                    <Play className="size-4" />
                    {t("platformOwners.actions.restore")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  {t("platformOwners.actions.delete")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {editOpen && (
        <PlatformOwnerEditDialog open={editOpen} onOpenChange={setEditOpen} owner={owner} />
      )}
      {deleteOpen && (
        <PlatformOwnerDeleteDialog
          open={deleteOpen}
          onOpenChange={(v) => {
            setDeleteOpen(v);
            if (!v) onAfterDelete();
          }}
          owner={owner}
        />
      )}
    </Card>
  );
}

function IdentityCard({ owner }: { owner: PlatformOwnerRow }) {
  const { t } = useTranslation();
  return (
    <Card className="card-elevated p-5 space-y-3">
      <h2 className="text-base font-semibold">{t("platformOwners.detail.identity")}</h2>
      <Row label={t("platformOwners.fields.email")} value={owner.email ?? "—"} ltr />
      <p className="text-[11px] text-muted-foreground flex items-center gap-1 -mt-2">
        <Info className="size-3" />
        {t("platformOwners.detail.emailFutureHint")}
      </p>
      <ProfilePhoneField label={t("platformOwners.fields.phone")} phone={owner.phone} />
      <Row label={t("platformOwners.fields.idNumber")} value={owner.id_number ?? "—"} ltr />
      <Row
        label={t("platformOwners.detail.created")}
        value={owner.created_at ? new Date(owner.created_at).toLocaleString("he-IL") : "—"}
      />
    </Card>
  );
}

function StatusCard({ owner }: { owner: PlatformOwnerRow }) {
  const { t } = useTranslation();
  return (
    <Card className="card-elevated p-5 space-y-3">
      <h2 className="text-base font-semibold">{t("platformOwners.detail.statusSection")}</h2>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{t("platformOwners.cols.status")}</span>
        {owner.is_active ? (
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
            {t("platformOwners.badges.active")}
          </Badge>
        ) : (
          <Badge variant="destructive">{t("platformOwners.badges.suspended")}</Badge>
        )}
      </div>
      <Row
        label={t("platformOwners.detail.level")}
        value={
          owner.level === "primary"
            ? t("platformOwners.badges.primary")
            : t("platformOwners.badges.owner")
        }
      />
      <Row
        label={t("platformOwners.detail.lastSignIn")}
        value={
          owner.last_sign_in_at
            ? new Date(owner.last_sign_in_at).toLocaleString("he-IL")
            : t("platformOwners.neverSignedIn")
        }
      />
    </Card>
  );
}

const CAPABILITY_IDS = [
  "fullManagement",
  "manageOwners",
  "transferPrimary",
  "viewOwners",
  "viewAudit",
  "crossBranch",
] as const;

const PRIMARY_ONLY_CAPABILITIES = new Set(["fullManagement", "manageOwners", "transferPrimary"]);

function CapabilitiesCard({ owner }: { owner: PlatformOwnerRow }) {
  const { t } = useTranslation();
  const isPrimary = owner.level === "primary";

  return (
    <Card className="card-elevated p-5 space-y-3">
      <h2 className="text-base font-semibold">{t("platformOwners.detail.capabilities")}</h2>
      <ul className="space-y-2">
        {CAPABILITY_IDS.map((id) => {
          const primaryOnly = PRIMARY_ONLY_CAPABILITIES.has(id);
          const enabled = isPrimary || !primaryOnly;
          return (
            <li
              key={id}
              className={`flex items-center gap-2 text-sm ${enabled ? "" : "text-muted-foreground line-through opacity-60"}`}
            >
              <CheckCircle2
                className={`size-4 shrink-0 ${enabled ? "text-emerald-500" : "text-muted-foreground"}`}
              />
              <span>{t(`platformOwners.capabilities.${id}`)}</span>
              {primaryOnly && (
                <Badge variant="secondary" className="mr-1 text-[10px]">
                  {t("platformOwners.detail.primaryOnly")}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm truncate ${ltr ? "font-mono" : ""}`} dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}
