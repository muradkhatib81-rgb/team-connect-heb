import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncFoundationSession } from "@/core/bootstrap";
import { isPlatformOwner, type AppRole } from "./constants";
import { formatEmployeeName } from "./employee-name";

export interface AuthProfile {
  id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  id_number: string | null;
  department_id: string | null;
  department_name: string | null;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
  must_change_password: boolean;
  roles: AppRole[];
  branch_id: string | null;
}

async function fetchSessionAndProfile(): Promise<AuthProfile | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  // Foundation Integration: best-effort session tracking via SessionManager
  // (device sessions, 12h expiration, inactivity cleanup). Fire-and-forget;
  // never affects the real Supabase-backed authentication outcome.
  void syncFoundationSession(user.id);

  // The signed-in user's own profile must always be fetched without the
  // active-branch filter — a system administrator viewing another branch
  // would otherwise get `null` here and appear signed out.
  const { unscopedFrom } = await import("@/integrations/supabase/branch-scope");
  const profilesFrom = unscopedFrom("profiles") as ReturnType<typeof supabase.from>;
  const [{ data: profile }, { data: roles }, { data: contactRows }] = await Promise.all([
    profilesFrom
      .select("id, first_name, last_name, full_name, department_id, job_title, is_active, branch_id, departments(name)")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.rpc("get_profile_contact", { _id: user.id }),
  ]);

  const p: any = profile ?? {};
  const contact: any = Array.isArray(contactRows) ? (contactRows[0] ?? {}) : (contactRows ?? {});
  return {
    id: user.id,
    email: user.email ?? null,
    first_name: p.first_name ?? "",
    last_name: p.last_name ?? "",
    full_name: formatEmployeeName(p),
    id_number: contact.id_number ?? null,
    department_id: p.department_id ?? null,
    department_name: p.departments?.name ?? null,
    job_title: p.job_title ?? null,
    phone: contact.phone ?? null,
    is_active: p.is_active ?? true,
    must_change_password: contact.must_change_password ?? false,
    roles: (roles ?? []).map((r) => r.role as AppRole),
    branch_id: p.branch_id ?? null,
  };
}

/**
 * Where a signed-in user must land: the Platform Dashboard for Platform
 * Owners (system_admin / main_admin — they must never be dropped into a
 * Branch automatically, see use-active-branch.tsx), `/dashboard` for
 * everyone else. Used by `/auth` and the `/` root redirect so every entry
 * point into the app agrees on the same landing rule.
 */
export async function resolveLandingPath(userId: string): Promise<"/platform" | "/dashboard"> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role as AppRole);
  return isPlatformOwner(roles) ? "/platform" : "/dashboard";
}

export function useAuth() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchSessionAndProfile,
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  return query;
}
