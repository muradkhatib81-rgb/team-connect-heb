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
 *   the header. Their last explicit selection is restored from
 *   `lov_active_branch_id` after login/reload so company / branch /
 *   warehouse (store) scope stay aligned. There is still no automatic
 *   "first branch" fallback when nothing was stored.
 *   Branch Mode is also entered via `setActiveBranchId` (switcher, create
 *   flow, or Platform Company → Branches — see `platform/branch-context.tsx`).
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
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && UUID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

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

  // Owner selection only — non-owners derive branch from profile (avoids null→id remount race).
  const [ownerSelectedId, setOwnerSelectedId] = useState<string | null>(() => readStored());
  const [ownerHydrated, setOwnerHydrated] = useState(false);

  const activeBranchId = !profile
    ? null
    : isOwner
      ? ownerSelectedId
      : ownBranchId;

  // Resolve owner selection once the branch list is ready.
  useEffect(() => {
    if (!profile || !isOwner) return;
    if (ownerHydrated || branchesQ.isLoading) return;
    const stored = readStored();
    if (stored && branches.some((b) => b.id === stored)) {
      setOwnerSelectedId(stored);
      setActiveBranchScope(stored);
    } else if (stored && branches.length > 0 && !branches.some((b) => b.id === stored)) {
      writeStored(null);
      setOwnerSelectedId(null);
      setActiveBranchScope(null);
    }
    setOwnerHydrated(true);
  }, [profile, isOwner, ownerHydrated, branches, branchesQ.isLoading]);

  // Keep storage + supabase scope in lockstep for locked (non-owner) roles.
  useEffect(() => {
    if (!profile || isOwner) return;
    writeStored(ownBranchId);
    setActiveBranchScope(ownBranchId);
  }, [profile, isOwner, ownBranchId]);

  // Keep the supabase scope in lockstep with the React state. Doing this
  // synchronously during render means the very next supabase.from(...)
  // call (including the ones triggered by invalidateQueries below) is
  // already scoped to the new branch.
  if (activeBranchId) setActiveBranchScope(activeBranchId);

  const setActiveBranchId = useCallback(
    (id: string | null) => {
      if (!isOwner) return; // locked
      if (id === ownerSelectedId) return;
      writeStored(id);
      setActiveBranchScope(id);
      setOwnerSelectedId(id);
      // Cancel inflight requests bound to the old branch and force every
      // data-bearing query to refetch under the new branch (or, when
      // clearing, back to Branch Mode being off).
      qc.cancelQueries();
      qc.invalidateQueries();
    },
    [isOwner, ownerSelectedId, qc],
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

  // Remount on branch switch for owners only. Non-owners keep a stable key so
  // profile→branch hydrate does not wipe the first paint and double-fetch.
  const treeKey = isOwner ? (activeBranchId ?? "no-branch") : "locked-branch";

  return (
    <ActiveBranchContext.Provider value={value}>
      <div key={treeKey} className="contents">
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
