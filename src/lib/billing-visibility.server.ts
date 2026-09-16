/**
 * Persist / read the platform-level customer payment visibility flag.
 * Does not read or write user_roles / user_task_permissions.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function readCustomerPaymentVisible(): Promise<boolean> {
  const { data, error } = await (supabaseAdmin as any)
    .from("platform_settings")
    .select("customer_payment_visible")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (/does not exist|column/i.test(error.message)) return false;
    throw new Error(error.message);
  }
  return data?.customer_payment_visible === true;
}

export async function writeCustomerPaymentVisible(visible: boolean): Promise<boolean> {
  const { data, error } = await (supabaseAdmin as any)
    .from("platform_settings")
    .update({ customer_payment_visible: visible })
    .eq("id", 1)
    .select("customer_payment_visible")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.customer_payment_visible === true;
}
