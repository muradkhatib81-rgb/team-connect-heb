-- Live flag sync for authenticated clients without widening platform_settings.
-- platform_settings SELECT stays Platform Owner only (whatsapp, billing, etc.).
-- This 1-row mirror exposes only catalog flag columns + min_client_version.
-- Does NOT alter user_roles, user_task_permissions, or customer_billing_visible.
-- Flag delivery is independent of platform.realtime (product presence kill-switch).

CREATE TABLE IF NOT EXISTS public.platform_feature_flag_sync (
  id smallint PRIMARY KEY CHECK (id = 1),
  ff_maintenance_mode boolean NOT NULL DEFAULT false,
  ff_global_analytics boolean NOT NULL DEFAULT true,
  ff_beta_ai boolean NOT NULL DEFAULT true,
  ff_announcements boolean NOT NULL DEFAULT true,
  ff_self_serve_company_signup boolean NOT NULL DEFAULT false,
  ff_force_client_update boolean NOT NULL DEFAULT false,
  ff_realtime boolean NOT NULL DEFAULT true,
  ff_storage_quota_warnings boolean NOT NULL DEFAULT false,
  min_client_version text NOT NULL DEFAULT '1.0.0',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_feature_flag_sync IS
  '1-row mirror of durable platform feature flags for Realtime postgres_changes. Authenticated SELECT only; no other platform_settings columns.';

ALTER TABLE public.platform_feature_flag_sync ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_feature_flag_sync FROM PUBLIC, anon;
GRANT SELECT ON public.platform_feature_flag_sync TO authenticated;
GRANT ALL ON public.platform_feature_flag_sync TO service_role;

DROP POLICY IF EXISTS platform_feature_flag_sync_select ON public.platform_feature_flag_sync;
CREATE POLICY platform_feature_flag_sync_select
  ON public.platform_feature_flag_sync
  FOR SELECT
  TO authenticated
  USING (id = 1);

CREATE OR REPLACE FUNCTION public.sync_platform_feature_flag_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.platform_feature_flag_sync (
    id,
    ff_maintenance_mode,
    ff_global_analytics,
    ff_beta_ai,
    ff_announcements,
    ff_self_serve_company_signup,
    ff_force_client_update,
    ff_realtime,
    ff_storage_quota_warnings,
    min_client_version,
    updated_at
  )
  VALUES (
    1,
    NEW.ff_maintenance_mode,
    NEW.ff_global_analytics,
    NEW.ff_beta_ai,
    NEW.ff_announcements,
    NEW.ff_self_serve_company_signup,
    NEW.ff_force_client_update,
    NEW.ff_realtime,
    NEW.ff_storage_quota_warnings,
    NEW.min_client_version,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    ff_maintenance_mode = EXCLUDED.ff_maintenance_mode,
    ff_global_analytics = EXCLUDED.ff_global_analytics,
    ff_beta_ai = EXCLUDED.ff_beta_ai,
    ff_announcements = EXCLUDED.ff_announcements,
    ff_self_serve_company_signup = EXCLUDED.ff_self_serve_company_signup,
    ff_force_client_update = EXCLUDED.ff_force_client_update,
    ff_realtime = EXCLUDED.ff_realtime,
    ff_storage_quota_warnings = EXCLUDED.ff_storage_quota_warnings,
    min_client_version = EXCLUDED.min_client_version,
    updated_at = now()
  WHERE
    public.platform_feature_flag_sync.ff_maintenance_mode IS DISTINCT FROM EXCLUDED.ff_maintenance_mode
    OR public.platform_feature_flag_sync.ff_global_analytics IS DISTINCT FROM EXCLUDED.ff_global_analytics
    OR public.platform_feature_flag_sync.ff_beta_ai IS DISTINCT FROM EXCLUDED.ff_beta_ai
    OR public.platform_feature_flag_sync.ff_announcements IS DISTINCT FROM EXCLUDED.ff_announcements
    OR public.platform_feature_flag_sync.ff_self_serve_company_signup IS DISTINCT FROM EXCLUDED.ff_self_serve_company_signup
    OR public.platform_feature_flag_sync.ff_force_client_update IS DISTINCT FROM EXCLUDED.ff_force_client_update
    OR public.platform_feature_flag_sync.ff_realtime IS DISTINCT FROM EXCLUDED.ff_realtime
    OR public.platform_feature_flag_sync.ff_storage_quota_warnings IS DISTINCT FROM EXCLUDED.ff_storage_quota_warnings
    OR public.platform_feature_flag_sync.min_client_version IS DISTINCT FROM EXCLUDED.min_client_version;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_settings_sync_feature_flags ON public.platform_settings;
CREATE TRIGGER platform_settings_sync_feature_flags
  AFTER INSERT OR UPDATE OF
    ff_maintenance_mode,
    ff_global_analytics,
    ff_beta_ai,
    ff_announcements,
    ff_self_serve_company_signup,
    ff_force_client_update,
    ff_realtime,
    ff_storage_quota_warnings,
    min_client_version
  ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_platform_feature_flag_state();

INSERT INTO public.platform_feature_flag_sync (
  id,
  ff_maintenance_mode,
  ff_global_analytics,
  ff_beta_ai,
  ff_announcements,
  ff_self_serve_company_signup,
  ff_force_client_update,
  ff_realtime,
  ff_storage_quota_warnings,
  min_client_version,
  updated_at
)
SELECT
  1,
  ps.ff_maintenance_mode,
  ps.ff_global_analytics,
  ps.ff_beta_ai,
  ps.ff_announcements,
  ps.ff_self_serve_company_signup,
  ps.ff_force_client_update,
  ps.ff_realtime,
  ps.ff_storage_quota_warnings,
  ps.min_client_version,
  now()
FROM public.platform_settings AS ps
WHERE ps.id = 1
ON CONFLICT (id) DO UPDATE SET
  ff_maintenance_mode = EXCLUDED.ff_maintenance_mode,
  ff_global_analytics = EXCLUDED.ff_global_analytics,
  ff_beta_ai = EXCLUDED.ff_beta_ai,
  ff_announcements = EXCLUDED.ff_announcements,
  ff_self_serve_company_signup = EXCLUDED.ff_self_serve_company_signup,
  ff_force_client_update = EXCLUDED.ff_force_client_update,
  ff_realtime = EXCLUDED.ff_realtime,
  ff_storage_quota_warnings = EXCLUDED.ff_storage_quota_warnings,
  min_client_version = EXCLUDED.min_client_version,
  updated_at = now();

INSERT INTO public.platform_feature_flag_sync (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'platform_feature_flag_sync'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_feature_flag_sync;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'platform_announcements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_announcements;
  END IF;
END
$$;
