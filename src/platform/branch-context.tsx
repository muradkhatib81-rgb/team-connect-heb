/**
 * Branch Context — active Branch within the active Company.
 *
 * Reads Branches through the existing Branches module (`branchService`,
 * see ../modules/branches), scoped to the active Company from
 * `CompanyContext`. Mirrors `CompanyContext` exactly, one level down the
 * multi-tenant hierarchy (Platform -> Companies -> Branches). Mounted
 * inside `CompanyProvider` (see routes/_authenticated/platform/route.tsx),
 * since Branches only make sense within an active Company. Unrelated to
 * the existing application's single-tenant branch logic
 * (`@/lib/use-active-branch`), which is untouched.
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
import type { UUID } from "../core/types";
import type { Branch } from "../modules/branches";
import { branchService } from "../modules/branches";
import { useCompanyContext } from "./company-context";

const ACTIVE_BRANCH_STORAGE_KEY = "lov_active_platform_branch_id";

export interface BranchContextValue {
  /** Alias for `activeBranchId`, kept for backward compatibility. */
  branchId: UUID | null;
  activeBranchId: UUID | null;
  activeBranch: Branch | null;
  branches: Branch[];
  isLoading: boolean;
  setActiveBranchId: (id: UUID | null) => void;
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

// Stable reference so `branches` doesn't change identity on every render
// while the query has no data yet (avoids re-triggering dependent hooks).
const EMPTY_BRANCHES: Branch[] = [];

export function BranchProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useCompanyContext();
  const queryClient = useQueryClient();
  const [activeBranchId, setActiveBranchIdState] = useState<UUID | null>(readStoredBranchId);

  const branchesQuery = useQuery({
    queryKey: branchesQueryKey(activeCompanyId),
    queryFn: () => branchService.listBranches(activeCompanyId as UUID),
    enabled: !!activeCompanyId,
  });

  const branches = branchesQuery.data ?? EMPTY_BRANCHES;

  const setActiveBranchId = useCallback((id: UUID | null) => {
    setActiveBranchIdState(id);
    writeStoredBranchId(id);
  }, []);

  // Keep the active Branch valid: fall back to the first Branch of the
  // active Company whenever the stored selection doesn't belong to it
  // (deleted, never set, or the active Company itself just changed).
  useEffect(() => {
    if (branchesQuery.isLoading) return;
    if (activeBranchId && branches.some((branch) => branch.id === activeBranchId)) return;
    setActiveBranchId(branches[0]?.id ?? null);
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
