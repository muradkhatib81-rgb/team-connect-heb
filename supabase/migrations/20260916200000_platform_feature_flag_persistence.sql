-- Persist enabled state for the three Platform Feature Flag catalog keys.
-- Additive only. Does NOT alter user_roles, user_task_permissions, or existing RLS.
-- Customer payment UI stays on customer_billing_visible — not these flags.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ff_maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ff_global_analytics boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ff_beta_ai boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.platform_settings.ff_maintenance_mode IS
  'platform.maintenance_mode. When true, non–Platform Owner users are blocked from the authenticated app. Platform Owners keep full access.';
COMMENT ON COLUMN public.platform_settings.ff_global_analytics IS
  'platform.global_analytics. When false, hide/disable Platform Global Analytics (nav + /platform/analytics).';
COMMENT ON COLUMN public.platform_settings.ff_beta_ai IS
  'platform.beta_ai. When false, hide Ask AI and block AI chat for anyone who is not a Platform Owner. Existing grants still apply when true.';

-- Authenticated users may read the three flags without seeing other platform_settings columns.
CREATE OR REPLACE FUNCTION public.get_platform_feature_flags()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'platform.maintenance_mode', ps.ff_maintenance_mode,
        'platform.global_analytics', ps.ff_global_analytics,
        'platform.beta_ai', ps.ff_beta_ai
      )
      FROM public.platform_settings AS ps
      WHERE ps.id = 1
    ),
    jsonb_build_object(
      'platform.maintenance_mode', false,
      'platform.global_analytics', true,
      'platform.beta_ai', true
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_platform_feature_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_feature_flags() TO authenticated, service_role;
