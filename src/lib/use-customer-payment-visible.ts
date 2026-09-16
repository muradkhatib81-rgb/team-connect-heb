import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CUSTOMER_PAYMENT_VISIBLE_QUERY_KEY,
  parseCustomerPaymentVisible,
} from "@/lib/billing-visibility";

/** Fail-closed: missing RPC/column or errors hide customer payment UI. */
export function useCustomerPaymentVisible() {
  return useQuery({
    queryKey: CUSTOMER_PAYMENT_VISIBLE_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_public_platform_settings");
      if (error) return false;
      const row = Array.isArray(data) ? data[0] : data;
      return parseCustomerPaymentVisible(row);
    },
    staleTime: 60_000,
    placeholderData: false,
  });
}
