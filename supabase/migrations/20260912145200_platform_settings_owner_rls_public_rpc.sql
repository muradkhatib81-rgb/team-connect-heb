-- Batch 1a (modified): SaaS platform_settings hardening without breaking login/PWA.
-- Public fields (whatsapp, pwa icon) via SECURITY DEFINER RPC.
-- Direct table SELECT/UPDATE limited to platform owners.
-- Does not change role names or company isolation yet.

CREATE OR REPLACE FUNCTION public.get_public_platform_settings()
RETURNS TABLE (
  whatsapp_number text,
  pwa_icon_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ps.whatsapp_number, ps.pwa_icon_url
  FROM public.platform_settings AS ps
  WHERE ps.id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_platform_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS platform_settings_select_all ON public.platform_settings;
DROP POLICY IF EXISTS platform_settings_select_authenticated ON public.platform_settings;
DROP POLICY IF EXISTS "company_settings_select_all" ON public.platform_settings;

CREATE POLICY platform_settings_select_owners
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS platform_settings_update_owners ON public.platform_settings;
CREATE POLICY platform_settings_update_owners
  ON public.platform_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

REVOKE SELECT ON public.platform_settings FROM anon;
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
