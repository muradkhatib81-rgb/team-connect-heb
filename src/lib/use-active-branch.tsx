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
import {
  installBranchScope,
  setActiveBranchScope,
} from "@/integrations/supabase/branch-scope";
import { useAuth } from "@/lib/use-auth";

// Install the supabase.from(...) proxy once at module load so every
// branch-scoped table is automatically filtered to the active branch.
installBranchScope();

/**
 * Active Branch layer.
 *
 * - System administrators may switch the active branch from the header.
 *   The selection persists in localStorage.
 * - Every other role is locked to the branch attached to their profile;
 *   the switcher is hidden for them.
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
  setActiveBranchId: (id: string) => void;
};

const ActiveBranchContext = createContext<Ctx | null>(null);

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

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
  const isSysAdmin = !!profile?.roles?.includes("system_admin");

  // System admin sees all branches. Others only need their own.
  const branchesQ = useQuery({
    enabled: !!profile?.id,
    queryKey: ["active-branch", "list", isSysAdmin, (profile as any)?.branch_id],
    queryFn: async (): Promise<BranchOption[]> => {
      if (isSysAdmin) {
        const { data, error } = await supabase
          .from("branches")
          .select("id, name, code, address, is_active")
          .order("name", { ascending: true });
        if (error) throw error;
        return (data ?? []) as BranchOption[];
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
    if (!isSysAdmin) {
      // Non-sysadmins: locked to their own branch.
      if (activeBranchId !== ownBranchId) {
        setActiveBranchIdState(ownBranchId);
        writeStored(ownBranchId);
      }
      return;
    }
    if (branches.length === 0) return;
    const stored = readStored();
    const valid = stored && branches.some((b) => b.id === stored) ? stored : null;
    const next = valid ?? ownBranchId ?? branches[0]?.id ?? null;
    if (next !== activeBranchId) {
      setActiveBranchIdState(next);
      writeStored(next);
    }
  }, [profile, isSysAdmin, ownBranchId, branches, activeBranchId]);

  // Keep the supabase scope in lockstep with the React state. Doing this
  // synchronously during render means the very next supabase.from(...)
  // call (including the ones triggered by invalidateQueries below) is
  // already scoped to the new branch.
  if (activeBranchId) setActiveBranchScope(activeBranchId);

  const setActiveBranchId = useCallback(
    (id: string) => {
      if (!isSysAdmin) return; // locked
      if (id === activeBranchId) return;
      writeStored(id);
      setActiveBranchScope(id);
      setActiveBranchIdState(id);
      // Cancel inflight requests bound to the old branch and force every
      // data-bearing query to refetch under the new branch.
      qc.cancelQueries();
      qc.invalidateQueries();
    },
    [isSysAdmin, activeBranchId, qc],
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
      canSwitch: isSysAdmin && branches.length > 1,
      isLoading: branchesQ.isLoading,
      setActiveBranchId,
    }),
    [activeBranchId, activeBranch, branches, isSysAdmin, branchesQ.isLoading, setActiveBranchId],
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
