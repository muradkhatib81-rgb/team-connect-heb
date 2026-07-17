import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { installBranchScope, setActiveBranchScope } from "@/integrations/supabase/branch-scope";
import { useAuth } from "@/lib/use-auth";
import { isPlatformOwner } from "@/lib/constants";
import { listRealBranches } from "@/lib/real-branches-directory";

// Install the supabase.from(...) proxy once at module load so every
// branch-scoped table is automatically filtered to the active branch.
installBranchScope();

/**
 * Active Branch layer.
 *
 * - Platform Owners (system_admin / main_admin — see `isPlatformOwner`) may
 *   browse every Branch on the Platform and switch the active Branch from
 *   the header, but are NEVER dropped into one automatically: there is no
 *   restored selection and no "first branch" fallback. Branch Mode only
 *   starts once they explicitly call `setActiveBranchId` during the
 *   current session (e.g. via the Branch switcher, or by entering a Branch
 *   from the Platform's Company → Branches flow — see
 *   `platform/branch-context.tsx`, which bridges into this same gate so
 *   "Branch Mode" is one single, real state shared by both entry points).
 *   A fresh load/login always starts with no active Branch, landing on the
 *   Platform Dashboard.
 * - Every other role is locked to the branch attached to their profile;
 *   the switcher is hidden for them (unchanged).
 * - Switching the active branch clears the React Query cache so every
 *   page refetches against the new branch context.
 *
 * Pages that already filter by branch_id (RLS / server functions) get
 * the right data automatically once they refetch. Pages can also read
 * `useActiveBranch()` directly when they need the id explicitly.
 */

const STORAGE_KEY = "lov_active_branch_id";

export type BranchOption = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  is_active: boolean;
};

type Ctx = {
  activeBranchId: string | null;
  activeBranch: BranchOption | null;
  branches: BranchOption[];
  canSwitch: boolean;
  isLoading: boolean;
  setActiveBranchId: (id: string | null) => void;
};

const ActiveBranchContext = createContext<Ctx | null>(null);

function writeStored(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function ActiveBranchProvider({ children }: { children: ReactNode }) {
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const isOwner = isPlatformOwner(profile?.roles ?? []);

  // Platform Owners (system_admin / main_admin) may browse every Branch on
  // the Platform. Others only need their own.
  const branchesQ = useQuery({
    enabled: !!profile?.id,
    queryKey: ["active-branch", "list", isOwner, (profile as any)?.branch_id],
    queryFn: async (): Promise<BranchOption[]> => {
      if (isOwner) {
        return listRealBranches();
      }
      const ownId = (profile as any)?.branch_id ?? null;
      if (!ownId) return [];
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, code, address, is_active")
        .eq("id", ownId)
        .maybeSingle();
      if (error) throw error;
      return data ? [data as BranchOption] : [];
    },
  });

  const branches = branchesQ.data ?? [];
  const ownBranchId = (profile as any)?.branch_id ?? null;

  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(null);

  // Resolve initial / corrected active branch whenever inputs change.
  useEffect(() => {
    if (!profile) return;
    if (!isOwner) {
      // Every other role stays locked to their own branch (unchanged).
      if (activeBranchId !== ownBranchId) {
        setActiveBranchIdState(ownBranchId);
        writeStored(ownBranchId);
      }
      return;
    }
    // Platform Owners must never be dropped into a Branch automatically:
    // no restored selection, no "first branch" fallback. `activeBranchId`
    // only ever changes via an explicit `setActiveBranchId` call — nothing
    // to reconcile here. Note this intentionally does NOT clear an active
    // id that isn't in the (single-tenant) Supabase `branches` list: Branch
    // Mode can also be entered via the Platform's Company → Branches flow
    // (see `platform/branch-context.tsx`), whose Branch ids live in a
    // separate, in-memory multi-tenant store. Clearing on "not found" would
    // fight that bridge every time it sets a Platform Branch as active.
  }, [profile, isOwner, ownBranchId, activeBranchId]);

  // Keep the supabase scope in lockstep with the React state. Doing this
  // synchronously during render means the very next supabase.from(...)
  // call (including the ones triggered by invalidateQueries below) is
  // already scoped to the new branch.
  if (activeBranchId) setActiveBranchScope(activeBranchId);

  const setActiveBranchId = useCallback(
    (id: string | null) => {
      if (!isOwner) return; // locked
      if (id === activeBranchId) return;
      writeStored(id);
      setActiveBranchScope(id);
      setActiveBranchIdState(id);
      // Cancel inflight requests bound to the old branch and force every
      // data-bearing query to refetch under the new branch (or, when
      // clearing, back to Branch Mode being off).
      qc.cancelQueries();
      qc.invalidateQueries();
    },
    [isOwner, activeBranchId, qc],
  );

  const activeBranch = useMemo(
    () => branches.find((b) => b.id === activeBranchId) ?? null,
    [branches, activeBranchId],
  );

  const value = useMemo<Ctx>(
    () => ({
      activeBranchId,
      activeBranch,
      branches,
      canSwitch: isOwner && branches.length > 0,
      isLoading: branchesQ.isLoading,
      setActiveBranchId,
    }),
    [activeBranchId, activeBranch, branches, isOwner, branchesQ.isLoading, setActiveBranchId],
  );

  return (
    <ActiveBranchContext.Provider value={value}>
      {/* Keying on activeBranchId forces a full subtree remount when the
          admin switches branches: every route component unmounts, local
          state is cleared, and queries refetch from scratch under the
          new scope. Prevents any stale-branch data from lingering. */}
      <div key={activeBranchId ?? "no-branch"} className="contents">
        {children}
      </div>
    </ActiveBranchContext.Provider>
  );
}

export function useActiveBranch(): Ctx {
  const ctx = useContext(ActiveBranchContext);
  if (!ctx) {
    // Safe fallback so components rendered outside the provider don't crash.
    return {
      activeBranchId: null,
      activeBranch: null,
      branches: [],
      canSwitch: false,
      isLoading: false,
      setActiveBranchId: () => {},
    };
  }
  return ctx;
}
