/**
 * Branch Context — active Branch within the active Company.
 *
 * Reads Branches through the existing Branches module (`branchService`,
 * see ../modules/branches), scoped to the active Company from
 * `CompanyContext`. Mirrors `CompanyContext` exactly, one level down the
 * multi-tenant hierarchy (Platform -> Companies -> Branches). Mounted
 * inside `CompanyProvider` (see routes/_authenticated/platform/route.tsx),
 * since Branches only make sense within an active Company.
 *
 * Bridges into the application's single Branch Mode gate
 * (`@/lib/use-active-branch`): activating a Platform Branch here also
 * flips that same real `activeBranchId`, and clearing/switching Company
 * here exits it — so "Branch Mode" (and every existing branch module it
 * gates: Dashboard, Employees, Departments, Schedules, Tasks, Messages,
 * Reports, Settings…) is one single, real state shared by both the
 * Platform's Company -> Branches flow and the header Branch switcher.
 */

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
import { toast } from "sonner";
import type { UUID } from "../core/types";
import type { Branch } from "../modules/branches";
import { branchService } from "../modules/branches";
import { useActiveBranch } from "../lib/use-active-branch";
import { useCompanyContext } from "./company-context";

const ACTIVE_BRANCH_STORAGE_KEY = "lov_active_platform_branch_id";

export interface BranchContextValue {
  /** Alias for `activeBranchId`, kept for backward compatibility. */
  branchId: UUID | null;
  activeBranchId: UUID | null;
  activeBranch: Branch | null;
  branches: Branch[];
  isLoading: boolean;
  /**
   * Takes the full `Branch` (not just its id) so it can bridge into Branch
   * Mode via `sourceBranchId` without depending on `branches`/the query
   * cache already containing it (e.g. immediately after assigning a new
   * Branch, or when switching Company and Branch in the same action — see
   * `routes/_authenticated/platform/branches.$branchId.tsx`).
   */
  setActiveBranchId: (branch: Branch | null) => void;
  refresh: () => Promise<void>;
}

const DEFAULT_BRANCH_CONTEXT: BranchContextValue = {
  branchId: null,
  activeBranchId: null,
  activeBranch: null,
  branches: [],
  isLoading: false,
  setActiveBranchId: () => {},
  refresh: async () => {},
};

const BranchContext = createContext<BranchContextValue>(DEFAULT_BRANCH_CONTEXT);

function readStoredBranchId(): UUID | null {
  if (typeof window === "undefined") return null;
  return (window.localStorage.getItem(ACTIVE_BRANCH_STORAGE_KEY) as UUID | null) ?? null;
}

function writeStoredBranchId(id: UUID | null): void {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(ACTIVE_BRANCH_STORAGE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_BRANCH_STORAGE_KEY);
}

/**
 * Shared query key for a Company's Branches. Exported so any consumer
 * (Branch Management page, Company Details "Branches" tab, dialogs) can
 * invalidate/read the exact same cache entry instead of duplicating the
 * fetch, regardless of whether that Company is the currently active one.
 */
export function branchesQueryKey(companyId: UUID | null) {
  return ["platform-branches", companyId] as const;
}

/** Query key for every Branch assignment on the Platform, across every Company — used to check whether a real branch is already assigned before offering it for assignment. */
export const ALL_BRANCH_ASSIGNMENTS_QUERY_KEY = ["platform-branches", "__all__"] as const;

// Stable reference so `branches` doesn't change identity on every render
// while the query has no data yet (avoids re-triggering dependent hooks).
const EMPTY_BRANCHES: Branch[] = [];

export function BranchProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId, activeCompany } = useCompanyContext();
  const queryClient = useQueryClient();
  const [activeBranchId, setActiveBranchIdState] = useState<UUID | null>(readStoredBranchId);
  const realActiveBranch = useActiveBranch();

  const branchesQuery = useQuery({
    queryKey: branchesQueryKey(activeCompanyId),
    queryFn: () => branchService.listBranches(activeCompanyId as UUID),
    enabled: !!activeCompanyId,
  });

  const branches = branchesQuery.data ?? EMPTY_BRANCHES;

  const setActiveBranchId = useCallback(
    (branch: Branch | null) => {
      // Inactive/suspended Companies must never allow entering Branch Mode
      // (Part 1). Clearing (branch === null) is always allowed — it only
      // exits Branch Mode.
      if (branch && activeCompany && activeCompany.status !== "active") {
        toast.error("לא ניתן להיכנס למצב סניף עבור חברה לא פעילה או מושהית.");
        return;
      }
      setActiveBranchIdState(branch ? branch.id : null);
      writeStoredBranchId(branch ? branch.id : null);
      // Enter/exit the application's real Branch Mode gate along with the
      // Platform's own selection. Bridges via `sourceBranchId` — the real
      // Supabase branch id — never this assignment's own Platform id, so
      // every existing relationship (Employees, Departments, ...) of that
      // real branch keeps working unchanged. Taking the full `Branch`
      // object (rather than looking one up by id) means this never races
      // against the Branches query cache. See the module doc comment above
      // and `modules/branches/branch.model.ts`.
      realActiveBranch.setActiveBranchId(branch ? branch.sourceBranchId : null);
    },
    [realActiveBranch, activeCompany],
  );

  // Clear the active Branch if it no longer belongs to the active Company
  // (deleted, or the active Company itself just changed). No fallback to
  // "the first Branch of the Company": the Platform Owner must explicitly
  // choose a Branch (via the Branch switcher) — never an automatic pick.
  useEffect(() => {
    if (branchesQuery.isLoading) return;
    if (activeBranchId && !branches.some((branch) => branch.id === activeBranchId)) {
      setActiveBranchId(null);
    }
  }, [branches, activeBranchId, branchesQuery.isLoading, setActiveBranchId]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: branchesQueryKey(activeCompanyId) });
  }, [queryClient, activeCompanyId]);

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) ?? null,
    [branches, activeBranchId],
  );

  const value = useMemo<BranchContextValue>(
    () => ({
      branchId: activeBranchId,
      activeBranchId,
      activeBranch,
      branches,
      isLoading: branchesQuery.isLoading,
      setActiveBranchId,
      refresh,
    }),
    [activeBranchId, activeBranch, branches, branchesQuery.isLoading, setActiveBranchId, refresh],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranchContext(): BranchContextValue {
  return useContext(BranchContext);
}
