/**
 * Company Context — prepared for a future phase.
 *
 * Companies runtime is not implemented yet. This context intentionally has
 * no data source; it exists so future code can depend on a stable shape
 * (`useCompanyContext`) instead of being wired up all at once later.
 * Not mounted in routes/__root.tsx yet.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { UUID } from "../core/types";

export interface CompanyContextValue {
  companyId: UUID | null;
}

const DEFAULT_COMPANY_CONTEXT: CompanyContextValue = { companyId: null };

const CompanyContext = createContext<CompanyContextValue>(DEFAULT_COMPANY_CONTEXT);

export function CompanyProvider({
  companyId = null,
  children,
}: {
  companyId?: UUID | null;
  children: ReactNode;
}) {
  return <CompanyContext.Provider value={{ companyId }}>{children}</CompanyContext.Provider>;
}

export function useCompanyContext(): CompanyContextValue {
  return useContext(CompanyContext);
}
