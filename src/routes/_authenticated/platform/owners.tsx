import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import {
  Crown,
  Plus,
  Search,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pause,
  Play,
  Trash2,
  ArrowLeftRight,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/use-auth";
import {
  suspendPlatformOwner,
  restorePlatformOwner,
  type PlatformOwnerRow,
} from "@/lib/platform-owners.functions";
import {
  usePlatformOwnersQuery,
  PLATFORM_AUDIT_KEY,
  PLATFORM_OWNERS_KEY,
} from "@/lib/platform-owners.hooks";
import {
  PlatformOwnerCreateDialog,
  PlatformOwnerEditDialog,
  PlatformOwnerDeleteDialog,
  PlatformOwnerTransferDialog,
} from "@/components/platform/platform-owner-dialogs";

const searchSchema = z.object({
  q: z.string().optional().default(""),
  level: z.enum(["all", "primary", "owner"]).optional().default("all"),
  status: z.enum(["all", "active", "suspended"]).optional().default("all"),
});

export const Route = createFileRoute("/_authenticated/platform/owners")({
  validateSearch: searchSchema,
  component: PlatformOwnersPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error)?.message ?? "שגיאה"}
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">הדף לא נמצא</div>
  ),
});

function PlatformOwnersPage() {
  const { data: profile } = useAuth();
  const isPrimary = !!profile?.roles?.includes("system_admin");
  const navigate = useNavigate({ from: "/platform/owners" });
  const search = Route.useSearch();

  const owners = usePlatformOwnersQuery();
  const list = owners.data ?? [];
  const currentPrimary = list.find((o) => o.level === "primary") ?? null;

  const filtered = useMemo(() => {
    const q = search.q?.trim().toLowerCase() ?? "";
    return list.filter((o) => {
      if (search.level !== "all" && o.level !== search.level) return false;
      if (search.status === "active" && !o.is_active) return false;
      if (search.status === "suspended" && o.is_active) return false;
      if (q) {
        const hay = `${o.full_name} ${o.email ?? ""} ${o.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list, search.q, search.level, search.status]);

  const [openCreate, setOpenCreate] = useState(false);
  const [editOwner, setEditOwner] = useState<PlatformOwnerRow | null>(null);
  const [deleteOwner, setDeleteOwner] = useState<PlatformOwnerRow | null>(null);
  const [openTransfer, setOpenTransfer] = useState(false);

  const canTransfer = isPrimary && list.some((o) => o.level !== "primary" && o.is_active);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 shrink-0 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Crown className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">בעלי מערכת</h1>
            <p className="text-sm text-muted-foreground mt-1">ניהול חשבונות בעלי המערכת</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTransfer && (
            <Button
              variant="outline"
              onClick={() => setOpenTransfer(true)}
              className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              <ArrowLeftRight className="size-4" />
              העברת בעלות ראשית
            </Button>
          )}
          {isPrimary && (
            <Button onClick={() => setOpenCreate(true)} className="gap-2">
              <Plus className="size-4" />
              בעל מערכת חדש
            </Button>
          )}
        </div>
      </header>

      <Card className="card-elevated p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
          <div className="relative">
            <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search.q ?? ""}
              onChange={(e) =>
                navigate({ search: (prev) => ({ ...prev, q: e.target.value }) })
              }
              placeholder="חיפוש לפי שם, דוא״ל או טלפון…"
              className="pr-9"
            />
          </div>
          <Select
            value={search.level ?? "all"}
            onValueChange={(v) =>
              navigate({ search: (prev) => ({ ...prev, level: v as any }) })
            }
          >
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הרמות</SelectItem>
              <SelectItem value="primary">בעל מערכת ראשי</SelectItem>
              <SelectItem value="owner">בעל מערכת</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={search.status ?? "all"}
            onValueChange={(v) =>
              navigate({ search: (prev) => ({ ...prev, status: v as any }) })
            }
          >
            <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              <SelectItem value="active">פעיל</SelectItem>
              <SelectItem value="suspended">מושעה</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="card-elevated overflow-hidden">
        {owners.isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            {list.length === 0 ? "אין בעלי מערכת." : "אין תוצאות מתאימות לסינון."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-right p-3 font-medium">שם</th>
                  <th className="text-right p-3 font-medium hidden md:table-cell">דוא"ל</th>
                  <th className="text-right p-3 font-medium hidden lg:table-cell">טלפון</th>
                  <th className="text-right p-3 font-medium">רמה</th>
                  <th className="text-right p-3 font-medium">סטטוס</th>
                  <th className="text-right p-3 font-medium hidden lg:table-cell">נוצר</th>
                  <th className="text-right p-3 font-medium hidden lg:table-cell">כניסה אחרונה</th>
                  <th className="p-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <OwnerRow
                    key={o.user_id}
                    owner={o}
                    isPrimary={isPrimary}
                    isSelf={profile?.id === o.user_id}
                    onEdit={() => setEditOwner(o)}
                    onDelete={() => setDeleteOwner(o)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openCreate && (
        <PlatformOwnerCreateDialog open={openCreate} onOpenChange={setOpenCreate} />
      )}
      {editOwner && (
        <PlatformOwnerEditDialog
          open={!!editOwner}
          onOpenChange={(v) => !v && setEditOwner(null)}
          owner={editOwner}
        />
      )}
      {deleteOwner && (
        <PlatformOwnerDeleteDialog
          open={!!deleteOwner}
          onOpenChange={(v) => !v && setDeleteOwner(null)}
          owner={deleteOwner}
        />
      )}
      {openTransfer && (
        <PlatformOwnerTransferDialog
          open={openTransfer}
          onOpenChange={setOpenTransfer}
          owners={list}
          currentPrimary={currentPrimary}
        />
      )}
    </div>
  );
}

function OwnerRow({
  owner,
  isPrimary,
  isSelf,
  onEdit,
  onDelete,
}: {
  owner: PlatformOwnerRow;
  isPrimary: boolean;
  isSelf: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const suspendFn = useServerFn(suspendPlatformOwner);
  const restoreFn = useServerFn(restorePlatformOwner);

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
    <tr className="border-t hover:bg-accent/30">
      <td className="p-3">
        <Link
          to="/platform/owners/$userId"
          params={{ userId: owner.user_id }}
          className="flex items-center gap-3 min-w-0 hover:underline"
        >
          <Avatar className="size-9 shrink-0">
            {owner.avatar_url ? <AvatarImage src={owner.avatar_url} alt={owner.full_name} /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium truncate flex items-center gap-2">
              <span className="truncate">{owner.full_name || "—"}</span>
              {isTargetPrimary && (
                <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400">
                  <Crown className="size-3" />
                  בעל ראשי
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground md:hidden truncate" dir="ltr">
              {owner.email ?? ""}
            </div>
          </div>
        </Link>
      </td>
      <td className="p-3 hidden md:table-cell text-muted-foreground" dir="ltr">
        {owner.email ?? "—"}
      </td>
      <td className="p-3 hidden lg:table-cell text-muted-foreground" dir="ltr">
        {owner.phone ?? "—"}
      </td>
      <td className="p-3">
        {isTargetPrimary ? (
          <Badge variant="secondary" className="gap-1">
            <Crown className="size-3" />
            בעל המערכת הראשי
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="size-3" />
            בעל המערכת
          </Badge>
        )}
      </td>
      <td className="p-3">
        {owner.is_active ? (
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400">
            פעיל
          </Badge>
        ) : (
          <Badge variant="destructive">מושעה</Badge>
        )}
      </td>
      <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground tabular-nums">
        {owner.created_at ? new Date(owner.created_at).toLocaleDateString("he-IL") : "—"}
      </td>
      <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground tabular-nums">
        {owner.last_sign_in_at
          ? new Date(owner.last_sign_in_at).toLocaleString("he-IL")
          : "מעולם לא התחבר"}
      </td>
      <td className="p-3">
        {isPrimary && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit} className="gap-2">
                <Pencil className="size-4" />
                עריכת פרופיל
              </DropdownMenuItem>
              {!isTargetPrimary && !isSelf && (
                <>
                  <DropdownMenuSeparator />
                  {owner.is_active ? (
                    <DropdownMenuItem
                      onClick={() => suspendMut.mutate()}
                      disabled={suspendMut.isPending}
                      className="gap-2"
                    >
                      <Pause className="size-4" />
                      השעיה
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => restoreMut.mutate()}
                      disabled={restoreMut.isPending}
                      className="gap-2"
                    >
                      <Play className="size-4" />
                      שחזור
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    מחיקה
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}
