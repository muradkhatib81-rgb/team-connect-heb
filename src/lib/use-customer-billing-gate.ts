import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  getCustomerBillingGate,
  type CustomerBillingGateResult,
} from "@/lib/billing.functions";
import {
  CUSTOMER_BILLING_GATE_QUERY_KEY,
  canSeeCustomerPaymentNav,
  emptyCustomerBillingGate,
} from "@/lib/billing-visibility";
import { hasBranchActionPermission, useCurrentPermissions } from "@/lib/use-current-permissions";

export function customerBillingGateQueryKey(
  companyId?: string | null,
  branchId?: string | null,
) {
  return [...CUSTOMER_BILLING_GATE_QUERY_KEY, companyId ?? null, branchId ?? null] as const;
}

export function useCustomerBillingGate(opts?: { companyId?: string | null }) {
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const gateFn = useServerFn(getCustomerBillingGate);
  const companyId = opts?.companyId ?? null;
  const branchId = activeBranchId ?? profile?.branch_id ?? null;

  const query = useQuery({
    queryKey: customerBillingGateQueryKey(companyId, branchId),
    enabled: !!profile?.id,
    queryFn: () =>
      gateFn({
        data: {
          companyId: companyId ?? undefined,
          branchId: branchId ?? undefined,
        },
      }),
    staleTime: 30_000,
  });

  const gate: CustomerBillingGateResult = query.data ?? emptyCustomerBillingGate();
  return { ...query, gate };
}

export function useCustomerPaymentNavVisible() {
  const { data: profile } = useAuth();
  const permissionsQ = useCurrentPermissions(profile?.id);
  const { gate } = useCustomerBillingGate();
  const roles = profile?.roles ?? [];
  return canSeeCustomerPaymentNav({
    isPlatformOwner: gate.isPlatformOwner,
    isBranchManager: roles.includes("branch_manager"),
    canManageCompanySettings: hasBranchActionPermission(
      roles,
      permissionsQ.data,
      "can_manage_company_settings",
    ),
    customerPaymentUiVisible: gate.customerPaymentUiVisible,
  });
}
