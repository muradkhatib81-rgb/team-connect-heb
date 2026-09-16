-- Platform-level gate for customer-facing payment UI.
-- Default OFF: payment/checkout/subscription surfaces stay hidden from
-- everyone except Platform Owner. /platform/billing remains owner-only
-- for manual plan, AI minutes, and storage regardless of this flag.
-- Does not change roles, permissions, or company/branch RLS.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS customer_payment_visible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.platform_settings.customer_payment_visible IS
  'When true, customer-facing payment/billing UI may appear. Platform Owner /platform/billing stays available regardless.';

CREATE OR REPLACE FUNCTION public.get_public_platform_settings()
RETURNS TABLE (
  whatsapp_number text,
  pwa_icon_url text,
  customer_payment_visible boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ps.whatsapp_number,
    ps.pwa_icon_url,
    COALESCE(ps.customer_payment_visible, false)
  FROM public.platform_settings AS ps
  WHERE ps.id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_platform_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon, authenticated, service_role;
