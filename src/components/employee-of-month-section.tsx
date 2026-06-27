import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Settings, Loader2, UserRound } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCanManageEom } from "@/lib/use-eom-perm";

type Row = {
  id: string;
  year: number;
  month: number;
  employee_id: string;
  reason: string | null;
  image_url: string | null;
};
type Profile = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  departments: { name: string } | null;
};

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

async function signUrl(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export function EmployeeOfMonthSection() {
  const canManage = useCanManageEom();
  const qc = useQueryClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  useEffect(() => {
    const channel = supabase
      .channel("eom-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "employee_of_month" },
        () => qc.invalidateQueries({ queryKey: ["eom", "current", year, month] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, year, month]);



  const q = useQuery({
    queryKey: ["eom", "current", year, month],
    refetchOnMount: "always",
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc("get_employees_of_month", {
        _year: year,
        _month: month,
      });
      if (error) throw error;
      const raw = (rows ?? []) as Array<{
        id: string; year: number; month: number; employee_id: string;
        reason: string | null; image_url: string | null;
        full_name: string | null; avatar_url: string | null;
        job_title: string | null; department_name: string | null;
      }>;
      const list: Row[] = raw.map((r) => ({
        id: r.id, year: r.year, month: r.month, employee_id: r.employee_id,
        reason: r.reason, image_url: r.image_url,
      }));
      const profilesMap: Record<string, Profile> = {};
      raw.forEach((r) => {
        profilesMap[r.employee_id] = {
          id: r.employee_id,
          full_name: r.full_name ?? "—",
          avatar_url: r.avatar_url,
          job_title: r.job_title,
          departments: r.department_name ? { name: r.department_name } : null,
        };
      });
      if (list.length === 0) {
        return { list, profiles: profilesMap, images: {} as Record<string, string>, avatars: {} as Record<string, string> };
      }
      const imageEntries = await Promise.all(
        list.map(async (r) => [r.id, await signUrl("employee-of-month", r.image_url)] as const),
      );
      const avatarEntries = await Promise.all(
        raw.map(async (r) => [r.employee_id, await signUrl("avatars", r.avatar_url)] as const),
      );
      return {
        list,
        profiles: profilesMap,
        images: Object.fromEntries(imageEntries.filter(([, v]) => v)) as Record<string, string>,
        avatars: Object.fromEntries(avatarEntries.filter(([, v]) => v)) as Record<string, string>,
      };
    },
  });

  const list = q.data?.list ?? [];
  const count = list.length;
  const title = count >= 2 ? "🏆 עובדי החודש" : "🏆 עובד החודש";
  const monthLabel = `${HEBREW_MONTHS[month - 1]} ${year}`;

  return (
    <section>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 mb-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold flex items-center gap-2">
            <Trophy className="size-5 text-amber-500 shrink-0" />
            {title}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">{monthLabel}</p>
        </div>
        {canManage && (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/employee-of-month">
              <Settings className="size-4" />
              ניהול
            </Link>
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <Card className="card-elevated p-8 flex justify-center">
          <Loader2 className="size-5 animate-spin text-primary" />
        </Card>
      ) : count === 0 ? (
        <Card className="card-elevated p-6 text-center bg-gradient-to-b from-amber-50/60 to-background dark:from-amber-950/20 border-amber-200/60">
          <div className="flex justify-center mb-3">
            <div className="size-20 rounded-full ring-4 ring-amber-300/60 bg-accent text-accent-foreground flex items-center justify-center shadow-md">
              <UserRound className="size-9 opacity-60" />
            </div>
          </div>
          <div className="flex justify-center mb-2">
            <Trophy className="size-5 text-amber-500" />
          </div>
          <h3 className="font-bold text-base">🏆 עובד החודש</h3>
          <p className="text-sm text-muted-foreground mt-2">טרם נבחר עובד החודש.</p>
          {canManage && (
            <p className="text-xs text-muted-foreground mt-1">לחץ על "ניהול" כדי לבחור.</p>
          )}
        </Card>

      ) : (
        <>
          {/* Desktop / tablet grid */}
          <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((r) => (
              <EomCard
                key={r.id}
                row={r}
                profile={q.data!.profiles[r.employee_id]}
                image={q.data!.images[r.id] ?? q.data!.avatars[r.employee_id] ?? null}
              />
            ))}
          </div>
          {/* Mobile horizontal carousel */}
          <div className="sm:hidden -mx-4 px-4 overflow-x-auto snap-x snap-mandatory flex gap-3 pb-2">
            {list.map((r) => (
              <div key={r.id} className="snap-start shrink-0 w-[85%]">
                <EomCard
                  row={r}
                  profile={q.data!.profiles[r.employee_id]}
                  image={q.data!.images[r.id] ?? q.data!.avatars[r.employee_id] ?? null}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function EomCard({
  row,
  profile,
  image,
}: {
  row: Row;
  profile: Profile | undefined;
  image: string | null;
}) {
  const initials = (profile?.full_name ?? "?").trim().charAt(0);
  return (
    <Card className="card-elevated p-5 text-center bg-gradient-to-b from-amber-50/60 to-background dark:from-amber-950/20 border-amber-200/60">
      <div className="flex justify-center mb-3">
        <div className="size-24 rounded-full overflow-hidden ring-4 ring-amber-300/60 bg-accent text-accent-foreground flex items-center justify-center text-3xl font-bold shadow-md">
          {image ? (
            <img src={image} alt={profile?.full_name ?? ""} className="size-full object-cover" />
          ) : (
            <span>{initials}</span>
          )}
        </div>
      </div>
      <div className="flex justify-center mb-2">
        <Trophy className="size-5 text-amber-500" />
      </div>
      <h3 className="font-bold text-base truncate">{profile?.full_name ?? "—"}</h3>
      <p className="text-xs text-muted-foreground mt-1">
        {profile?.departments?.name ?? "—"}
        {profile?.job_title ? ` · ${profile.job_title}` : ""}
      </p>
      {row.reason && (
        <p className="text-sm mt-3 text-foreground/80 whitespace-pre-wrap break-words">{row.reason}</p>
      )}
    </Card>
  );
}
