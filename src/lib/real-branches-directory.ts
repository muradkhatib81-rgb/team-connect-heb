/**
 * Real (single-tenant) Branches directory — a thin, read-only helper around
 * the existing Supabase `branches` table. Shared by `useActiveBranch` (the
 * header/Branch Mode switcher) and the Platform's "assign existing branch"
 * flow (`components/platform/branch-dialogs.tsx`) so both read the exact
 * same real branches the exact same way, instead of duplicating the query.
 */

import { supabase } from "@/integrations/supabase/client";

export type RealBranchOption = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  is_active: boolean;
};

export async function listRealBranches(): Promise<RealBranchOption[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, code, address, is_active")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RealBranchOption[];
}

export const REAL_BRANCHES_QUERY_KEY = ["real-branches", "all"] as const;
