-- Storage quotas by billing plan (company / branch). Additive; no roles tables.

-- ---------------------------------------------------------------------------
-- 1) Catalog defaults: plan → storage quota (MB). NULL = unlimited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_storage_entitlements (
  billing_plan text PRIMARY KEY
    CHECK (billing_plan IN ('free', 'standard', 'enterprise')),
  storage_quota_mb integer NULL CHECK (storage_quota_mb IS NULL OR storage_quota_mb >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.billing_storage_entitlements (billing_plan, storage_quota_mb)
VALUES
  ('free', 512),
  ('standard', 10240),
  ('enterprise', NULL)
ON CONFLICT (billing_plan) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Per company / branch grant (same scope pattern as ai_grants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_storage_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('company', 'branch')),
  scope_id uuid NOT NULL,
  billing_plan text NULL
    CHECK (billing_plan IS NULL OR billing_plan IN ('free', 'standard', 'enterprise')),
  storage_quota_mb integer NULL CHECK (storage_quota_mb IS NULL OR storage_quota_mb >= 0),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  is_active boolean NOT NULL DEFAULT true,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS billing_storage_grants_scope_idx
  ON public.billing_storage_grants (scope_type, scope_id)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Privileges + RLS (platform owner only)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.billing_storage_entitlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.billing_storage_grants FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.billing_storage_entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.billing_storage_grants TO authenticated;
GRANT ALL ON public.billing_storage_entitlements TO service_role;
GRANT ALL ON public.billing_storage_grants TO service_role;

ALTER TABLE public.billing_storage_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_storage_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_storage_entitlements_owner ON public.billing_storage_entitlements;
CREATE POLICY billing_storage_entitlements_owner ON public.billing_storage_entitlements
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS billing_storage_grants_owner ON public.billing_storage_grants;
CREATE POLICY billing_storage_grants_owner ON public.billing_storage_grants
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));
