/**
 * Branch Context — prepared for a future phase.
 *
 * Branches runtime is not implemented yet. This context intentionally has
 * no data source; it exists so future code can depend on a stable shape
 * (`useBranchContext`) instead of being wired up all at once later.
 * Not mounted in routes/__root.tsx yet. Unrelated to the current
 * application's existing single-branch business logic, which is untouched.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { UUID } from "../core/types";

export interface BranchContextValue {
  branchId: UUID | null;
}

const DEFAULT_BRANCH_CONTEXT: BranchContextValue = { branchId: null };

const BranchContext = createContext<BranchContextValue>(DEFAULT_BRANCH_CONTEXT);

export function BranchProvider({
  branchId = null,
  children,
}: {
  branchId?: UUID | null;
  children: ReactNode;
}) {
  return <BranchContext.Provider value={{ branchId }}>{children}</BranchContext.Provider>;
}

export function useBranchContext(): BranchContextValue {
  return useContext(BranchContext);
}
