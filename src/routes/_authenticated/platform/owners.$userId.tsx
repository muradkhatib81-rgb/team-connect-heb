import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
  PLATFORM_EVENT_LABELS,
} from "@/lib/platform-owners.hooks";
import {
  PlatformOwnerEditDialog,
  PlatformOwnerDeleteDialog,
} from "@/components/platform/platform-owner-dialogs";
import { ProfilePhoneField } from "@/components/contact-actions";

export const Route = createFileRoute("/_authenticated/platform/owners/$userId")({
  component: PlatformOwnerDetailsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? "שגיאה"}
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">בעל המערכת לא נמצא</div>
  ),
});

function PlatformOwnerDetailsPage() {
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
            חזרה לרשימה
          </Link>
        </Button>
        <Card className="p-8 text-sm text-muted-foreground text-center">
          בעל המערכת לא נמצא
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-2">
        <Link to="/platform/owners">
          <ArrowRight className="size-4" />
          חזרה לרשימה
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
          <h2 className="text-base font-semibold">סיכום פעילות</h2>
          <Button asChild variant="ghost" size="sm" className="mr-auto">
            <Link to="/platform/audit-log">ליומן המלא</Link>
          </Button>
        </div>
        {audit.isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-4 animate-spin text-primary" />
          </div>
        ) : events.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">אין פעילות מתועדת</div>
        ) : (
          <ul className="divide-y">
            {events.map((ev) => (
              <li key={ev.id} className="p-3 text-sm flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-32">
                  {new Date(ev.created_at).toLocaleString("he-IL")}
                </span>
                <span className="font-medium">
                  {PLATFORM_EVENT_LABELS[ev.event] ?? ev.event}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ev.actor_id === owner.user_id ? "מבצע" : "יעד"}
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
    onSuccess: () => { toast.success("בעל המערכת הושעה"); invalidate(); },
    onError: (e: Error) => toast.error(e.message ?? "השעיה נכשלה"),
  });
  const restoreMut = useMutation({
    mutationFn: () => restoreFn({ data: { user_id: owner.user_id } }),
    onSuccess: () => { toast.success("בעל המערכת שוחזר"); invalidate(); },
    onError: (e: Error) => toast.error(e.message ?? "שחזור נכשל"),
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
                בעל ראשי
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="inline-flex items-center gap-1">
              <Crown className="size-3" />
              Business Identity · {isTargetPrimary ? "בעל המערכת הראשי" : "בעל המערכת"}
            </span>
          </p>
        </div>
        {isPrimary && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
              <Pencil className="size-4" />
              עריכה
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
                    השעיה
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
                    שחזור
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  מחיקה
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
  return (
    <Card className="card-elevated p-5 space-y-3">
      <h2 className="text-base font-semibold">זהות</h2>
      <Row label='דוא"ל' value={owner.email ?? "—"} ltr />
      <p className="text-[11px] text-muted-foreground flex items-center gap-1 -mt-2">
        <Info className="size-3" />
        שינוי דוא"ל הוא יכולת עתידית — יתווסף בגרסה הבאה של ניהול הפלטפורמה.
      </p>
      <ProfilePhoneField label="טלפון" phone={owner.phone} />
      <Row label="ת.ז" value={owner.id_number ?? "—"} ltr />
      <Row
        label="נוצר"
        value={owner.created_at ? new Date(owner.created_at).toLocaleString("he-IL") : "—"}
      />
    </Card>
  );
}

function StatusCard({ owner }: { owner: PlatformOwnerRow }) {
  return (
    <Card className="card-elevated p-5 space-y-3">
      <h2 className="text-base font-semibold">סטטוס וכניסה</h2>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">סטטוס</span>
        {owner.is_active ? (
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
            פעיל
          </Badge>
        ) : (
          <Badge variant="destructive">מושעה</Badge>
        )}
      </div>
      <Row label="רמה" value={owner.level === "primary" ? "בעל המערכת הראשי" : "בעל המערכת"} />
      <Row
        label="כניסה אחרונה"
        value={
          owner.last_sign_in_at
            ? new Date(owner.last_sign_in_at).toLocaleString("he-IL")
            : "מעולם לא התחבר"
        }
      />
    </Card>
  );
}

function CapabilitiesCard({ owner }: { owner: PlatformOwnerRow }) {
  const isPrimary = owner.level === "primary";
  const capabilities: { label: string; primaryOnly?: boolean }[] = [
    { label: "ניהול מלא של הפלטפורמה", primaryOnly: true },
    { label: "יצירה, השעיה ומחיקה של בעלי מערכת", primaryOnly: true },
    { label: "העברת בעלות ראשית", primaryOnly: true },
    { label: "צפייה בכל בעלי המערכת" },
    { label: "צפייה ביומן פעילות הפלטפורמה" },
    { label: "גישה חוצת-סניפים" },
  ];

  return (
    <Card className="card-elevated p-5 space-y-3">
      <h2 className="text-base font-semibold">יכולות פלטפורמה</h2>
      <ul className="space-y-2">
        {capabilities.map((c) => {
          const enabled = isPrimary || !c.primaryOnly;
          return (
            <li key={c.label} className={`flex items-center gap-2 text-sm ${enabled ? "" : "text-muted-foreground line-through opacity-60"}`}>
              <CheckCircle2 className={`size-4 shrink-0 ${enabled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <span>{c.label}</span>
              {c.primaryOnly && (
                <Badge variant="secondary" className="mr-1 text-[10px]">בעל ראשי בלבד</Badge>
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
