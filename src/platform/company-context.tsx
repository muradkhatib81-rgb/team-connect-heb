/**
 * Company Context — active Company for the Platform's Companies module.
 *
 * Reads Companies through the existing Companies module (`companyService`,
 * see ../modules/companies), scoped to the active Platform from
 * `PlatformContext`. It wraps the authenticated shell so navigation and
 * routed Platform content share one active Company selection.
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
import type { Company } from "../modules/companies";
import { companyService } from "../modules/companies";
import { isPlatformOwner } from "../lib/constants";
import { useAuth } from "../lib/use-auth";
import { usePlatformContext } from "./platform-context";

const ACTIVE_COMPANY_STORAGE_KEY = "lov_active_company_id";

export interface CompanyContextValue {
  /** Alias for `activeCompanyId`, kept for backward compatibility. */
  companyId: UUID | null;
  activeCompanyId: UUID | null;
  activeCompany: Company | null;
  companies: Company[];
  isLoading: boolean;
  setActiveCompanyId: (id: UUID | null) => void;
  refresh: () => Promise<void>;
}

const DEFAULT_COMPANY_CONTEXT: CompanyContextValue = {
  companyId: null,
  activeCompanyId: null,
  activeCompany: null,
  companies: [],
  isLoading: false,
  setActiveCompanyId: () => {},
  refresh: async () => {},
};

const CompanyContext = createContext<CompanyContextValue>(DEFAULT_COMPANY_CONTEXT);

function readStoredCompanyId(): UUID | null {
  if (typeof window === "undefined") return null;
  return (window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) as UUID | null) ?? null;
}

function writeStoredCompanyId(id: UUID | null): void {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
}

export function companiesQueryKey(platformId: UUID) {
  return ["platform-companies", platformId] as const;
}

// Stable reference so `companies` doesn't change identity on every render
// while the query has no data yet (avoids re-triggering dependent hooks).
const EMPTY_COMPANIES: Company[] = [];

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { platform } = usePlatformContext();
  const { data: profile, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const [activeCompanyId, setActiveCompanyIdState] = useState<UUID | null>(readStoredCompanyId);
  const canAccessCompanies = isPlatformOwner(profile?.roles ?? []);

  const companiesQuery = useQuery({
    queryKey: companiesQueryKey(platform.id),
    queryFn: () => companyService.listCompanies(platform.id),
    enabled: canAccessCompanies,
  });

  const companies = companiesQuery.data ?? EMPTY_COMPANIES;

  const setActiveCompanyId = useCallback((id: UUID | null) => {
    setActiveCompanyIdState(id);
    writeStoredCompanyId(id);
  }, []);

  // Clear the active Company if the stored selection no longer exists
  // (deleted). No fallback to "the first available Company": the Platform
  // Owner must explicitly choose a Company (via the Company switcher)
  // before its Branches become available — never an automatic pick.
  useEffect(() => {
    if (isAuthLoading || !canAccessCompanies || companiesQuery.isLoading) return;
    if (activeCompanyId && !companies.some((company) => company.id === activeCompanyId)) {
      setActiveCompanyId(null);
    }
  }, [
    activeCompanyId,
    canAccessCompanies,
    companies,
    companiesQuery.isLoading,
    isAuthLoading,
    setActiveCompanyId,
  ]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: companiesQueryKey(platform.id) });
  }, [queryClient, platform.id]);

  const activeCompany = useMemo(
    () => companies.find((company) => company.id === activeCompanyId) ?? null,
    [companies, activeCompanyId],
  );

  const value = useMemo<CompanyContextValue>(
    () => ({
      companyId: activeCompanyId,
      activeCompanyId,
      activeCompany,
      companies,
      isLoading: isAuthLoading || (canAccessCompanies && companiesQuery.isLoading),
      setActiveCompanyId,
      refresh,
    }),
    [
      activeCompanyId,
      activeCompany,
      companies,
      canAccessCompanies,
      companiesQuery.isLoading,
      isAuthLoading,
      setActiveCompanyId,
      refresh,
    ],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompanyContext(): CompanyContextValue {
  return useContext(CompanyContext);
}
