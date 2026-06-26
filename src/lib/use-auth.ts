import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "./constants";

export interface AuthProfile {
  id: string;
  email: string | null;
  full_name: string;
  id_number: string | null;
  department_id: string | null;
  department_name: string | null;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
  must_change_password: boolean;
  roles: AppRole[];
}

async function fetchSessionAndProfile(): Promise<AuthProfile | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("*, departments(name)")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  const p: any = profile ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    full_name: p.full_name ?? "",
    id_number: p.id_number ?? null,
    department_id: p.department_id ?? null,
    department_name: p.departments?.name ?? null,
    job_title: p.job_title ?? null,
    phone: p.phone ?? null,
    is_active: p.is_active ?? true,
    must_change_password: p.must_change_password ?? false,
    roles: (roles ?? []).map((r) => r.role as AppRole),
  };
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
