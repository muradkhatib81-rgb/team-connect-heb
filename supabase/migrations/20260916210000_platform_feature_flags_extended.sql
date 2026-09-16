-- Extend durable Platform Feature Flags (8 catalog keys). Additive only.
-- Does NOT alter user_roles, user_task_permissions, or customer_billing_visible.
-- Main Board is a core feature and is intentionally not flagged.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ff_announcements boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ff_self_serve_company_signup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ff_force_client_update boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ff_realtime boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ff_storage_quota_warnings boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_client_version text NOT NULL DEFAULT '1.0.0';

COMMENT ON COLUMN public.platform_settings.ff_announcements IS
  'platform.announcements. When false, hide viewer banners and the Platform Owner announcements page.';
COMMENT ON COLUMN public.platform_settings.ff_self_serve_company_signup IS
  'platform.self_serve_company_signup. Default false (locked). Public /company-signup is an honesty page; Platform Owners still create companies.';
COMMENT ON COLUMN public.platform_settings.ff_force_client_update IS
  'platform.force_client_update. When true, clients older than min_client_version are blocked. Platform Owners keep access.';
COMMENT ON COLUMN public.platform_settings.min_client_version IS
  'Minimum client version (major.minor.patch) for Android, iPhone, and Windows/web when force-update is on.';
COMMENT ON COLUMN public.platform_settings.ff_realtime IS
  'platform.realtime. When false, unmount presence/live bridge UI without affecting CRUD.';
COMMENT ON COLUMN public.platform_settings.ff_storage_quota_warnings IS
  'platform.storage_quota_warnings. When true, managers near storage quota see a warning. Not a billing-panel replacement.';

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
        'platform.beta_ai', ps.ff_beta_ai,
        'platform.announcements', ps.ff_announcements,
        'platform.self_serve_company_signup', ps.ff_self_serve_company_signup,
        'platform.force_client_update', ps.ff_force_client_update,
        'platform.realtime', ps.ff_realtime,
        'platform.storage_quota_warnings', ps.ff_storage_quota_warnings,
        'min_client_version', ps.min_client_version
      )
      FROM public.platform_settings AS ps
      WHERE ps.id = 1
    ),
    jsonb_build_object(
      'platform.maintenance_mode', false,
      'platform.global_analytics', true,
      'platform.beta_ai', true,
      'platform.announcements', true,
      'platform.self_serve_company_signup', false,
      'platform.force_client_update', false,
      'platform.realtime', true,
      'platform.storage_quota_warnings', false,
      'min_client_version', '1.0.0'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_platform_feature_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_feature_flags() TO authenticated, service_role;

-- Public subset for /company-signup and pre-auth client version checks.
CREATE OR REPLACE FUNCTION public.get_platform_client_gates()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'platform.self_serve_company_signup', ps.ff_self_serve_company_signup,
        'platform.force_client_update', ps.ff_force_client_update,
        'min_client_version', ps.min_client_version
      )
      FROM public.platform_settings AS ps
      WHERE ps.id = 1
    ),
    jsonb_build_object(
      'platform.self_serve_company_signup', false,
      'platform.force_client_update', false,
      'min_client_version', '1.0.0'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_platform_client_gates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_client_gates() TO anon, authenticated, service_role;

-- Platform announcements (company / branch / all). Do not reuse announcements.target_type='all'.
CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_announcements_scope_chk CHECK (
    branch_id IS NULL OR company_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS platform_announcements_active_idx
  ON public.platform_announcements (is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_announcements_company_idx
  ON public.platform_announcements (company_id);
CREATE INDEX IF NOT EXISTS platform_announcements_branch_idx
  ON public.platform_announcements (branch_id);

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_announcements FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_announcements TO authenticated;
GRANT ALL ON public.platform_announcements TO service_role;

DROP POLICY IF EXISTS platform_announcements_select ON public.platform_announcements;
CREATE POLICY platform_announcements_select ON public.platform_announcements
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR (
      is_active = true
      AND (
        (company_id IS NULL AND branch_id IS NULL)
        OR (company_id IS NOT NULL AND branch_id IS NULL AND company_id IN (SELECT public.my_company_ids()))
        OR (branch_id IS NOT NULL AND public.branch_in_my_companies(branch_id))
      )
    )
  );

DROP POLICY IF EXISTS platform_announcements_insert ON public.platform_announcements;
CREATE POLICY platform_announcements_insert ON public.platform_announcements
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS platform_announcements_update ON public.platform_announcements;
CREATE POLICY platform_announcements_update ON public.platform_announcements
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS platform_announcements_delete ON public.platform_announcements;
CREATE POLICY platform_announcements_delete ON public.platform_announcements
  FOR DELETE
  TO authenticated
  USING (public.is_platform_owner(auth.uid()));

-- Manager-facing storage warning without widening billing_storage_grants RLS.
CREATE OR REPLACE FUNCTION public.get_my_storage_quota_warning()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  uid uuid := auth.uid();
  can_see boolean := false;
  warn jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('warning', false);
  END IF;

  IF public.is_platform_owner(uid) THEN
    RETURN jsonb_build_object('warning', false);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = uid AND ur.role = 'branch_manager'
  ) THEN
    can_see := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = uid AND ur.role = 'assistant_manager'
  ) AND EXISTS (
    SELECT 1 FROM public.user_task_permissions utp
    WHERE utp.user_id = uid AND utp.can_manage_company_settings = true
  ) THEN
    can_see := true;
  END IF;

  IF NOT can_see THEN
    RETURN jsonb_build_object('warning', false);
  END IF;

  SELECT jsonb_build_object(
    'warning', true,
    'used_bytes', g.used_bytes,
    'storage_quota_mb', g.storage_quota_mb,
    'scope_type', g.scope_type,
    'percent', ROUND((g.used_bytes::numeric / (g.storage_quota_mb::numeric * 1024 * 1024)) * 100)
  )
  INTO warn
  FROM public.billing_storage_grants g
  WHERE g.is_active = true
    AND g.storage_quota_mb IS NOT NULL
    AND g.storage_quota_mb > 0
    AND g.used_bytes::numeric >= (g.storage_quota_mb::numeric * 1024 * 1024 * 0.8)
    AND (
      (g.scope_type = 'company' AND g.scope_id IN (SELECT public.my_company_ids()))
      OR (
        g.scope_type = 'branch'
        AND EXISTS (
          SELECT 1 FROM public.profile_scope_internal(uid) s
          WHERE s.branch_id = g.scope_id
        )
      )
    )
  ORDER BY (g.used_bytes::numeric / (g.storage_quota_mb::numeric * 1024 * 1024)) DESC
  LIMIT 1;

  RETURN COALESCE(warn, jsonb_build_object('warning', false));
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_storage_quota_warning() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_storage_quota_warning() TO authenticated, service_role;
