-- Platform Owner master toggle for customer-facing payment / checkout UI.
-- Additive only. Does NOT alter user_roles, user_task_permissions, or existing RLS.

-- Master switch: OFF = no customer payment/checkout/self-serve UI.
-- Platform Owner /platform/billing stays available either way.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS customer_billing_visible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.platform_settings.customer_billing_visible IS
  'When false, hide customer-facing payment/checkout/subscription self-serve. Platform Owner /platform/billing stays available.';

-- Per-company opt-in. Only applies when the platform master switch is on.
-- Default false so existing manual enterprise setups (e.g. Rami Levy) keep
-- using /platform/billing without exposing customer checkout.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS billing_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.billing_enabled IS
  'Per-company opt-in for customer payment UI. Takes effect only when platform_settings.customer_billing_visible is true.';

-- Authenticated users may read the master flag without seeing other platform_settings columns.
CREATE OR REPLACE FUNCTION public.get_customer_billing_visible()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ps.customer_billing_visible FROM public.platform_settings AS ps WHERE ps.id = 1),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.get_customer_billing_visible() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_billing_visible() TO authenticated, service_role;
