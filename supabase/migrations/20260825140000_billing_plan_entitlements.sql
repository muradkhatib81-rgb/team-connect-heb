-- Plan entitlements catalog + trial window on billing_accounts.
-- Additive only. Does NOT alter user_roles or user_task_permissions.

-- ---------------------------------------------------------------------------
-- 1) Trial end timestamp (manual or future Stripe trialing)
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_accounts
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS billing_accounts_trial_idx
  ON public.billing_accounts (trial_ends_at)
  WHERE status = 'trialing' AND trial_ends_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Catalog: plan → feature limits (NULL = unlimited)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_plan_entitlements (
  billing_plan text PRIMARY KEY
    CHECK (billing_plan IN ('free', 'standard', 'enterprise')),
  max_employees integer NULL CHECK (max_employees IS NULL OR max_employees >= 0),
  max_branches integer NULL CHECK (max_branches IS NULL OR max_branches >= 0),
  realtime_enabled boolean NOT NULL DEFAULT false,
  analytics_enabled boolean NOT NULL DEFAULT false,
  default_trial_days integer NOT NULL DEFAULT 0 CHECK (default_trial_days >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.billing_plan_entitlements (
  billing_plan, max_employees, max_branches, realtime_enabled, analytics_enabled, default_trial_days
)
VALUES
  ('free', 15, 1, false, false, 0),
  ('standard', 150, 5, true, true, 7),
  ('enterprise', NULL, NULL, true, true, 0)
ON CONFLICT (billing_plan) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Seed billing row for existing companies (free / active)
-- ---------------------------------------------------------------------------
INSERT INTO public.billing_accounts (company_id, plan, source, status)
SELECT c.id, 'free', 'manual', 'active'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.billing_accounts ba WHERE ba.company_id = c.id
);

-- ---------------------------------------------------------------------------
-- Privileges + RLS (platform owner only)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.billing_plan_entitlements FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.billing_plan_entitlements TO authenticated;
GRANT ALL ON public.billing_plan_entitlements TO service_role;

ALTER TABLE public.billing_plan_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_plan_entitlements_owner ON public.billing_plan_entitlements;
CREATE POLICY billing_plan_entitlements_owner ON public.billing_plan_entitlements
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));
