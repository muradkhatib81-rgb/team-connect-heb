-- AI Assistant foundation — provider-agnostic grants, billing entitlements, usage tracking.
-- Control: platform owner (+ optional ai_admin_delegates). Additive only.

-- ---------------------------------------------------------------------------
-- 1) Provider registry (platform-wide; secrets in server env, not DB)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_providers (
  code text PRIMARY KEY,
  display_name text NOT NULL,
  default_model text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ai_providers (code, display_name, default_model, sort_order)
VALUES
  ('gemini', 'Google Gemini', 'gemini-2.0-flash', 10),
  ('openai', 'OpenAI ChatGPT', 'gpt-4o-mini', 20),
  ('anthropic', 'Anthropic Claude', 'claude-3-5-haiku-latest', 30)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Billing plan → AI entitlements (links to BillingPlan stub / future Stripe)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_plan_entitlements (
  billing_plan text PRIMARY KEY
    CHECK (billing_plan IN ('free', 'standard', 'enterprise')),
  monthly_minutes integer NULL CHECK (monthly_minutes IS NULL OR monthly_minutes >= 0),
  default_provider_code text NOT NULL REFERENCES public.ai_providers(code),
  allows_provider_choice boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ai_plan_entitlements (billing_plan, monthly_minutes, default_provider_code, allows_provider_choice)
VALUES
  ('free', 30, 'gemini', false),
  ('standard', 300, 'gemini', false),
  ('enterprise', NULL, 'gemini', true)
ON CONFLICT (billing_plan) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Grants — company / branch / user scope
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('company', 'branch', 'user')),
  scope_id uuid NOT NULL,
  provider_code text NULL REFERENCES public.ai_providers(code),
  grant_source text NOT NULL DEFAULT 'manual_free'
    CHECK (grant_source IN ('manual_free', 'manual_paid', 'billing_plan')),
  billing_plan text NULL
    CHECK (billing_plan IS NULL OR billing_plan IN ('free', 'standard', 'enterprise')),
  quota_minutes integer NULL CHECK (quota_minutes IS NULL OR quota_minutes >= 0),
  quota_period text NOT NULL DEFAULT 'monthly'
    CHECK (quota_period IN ('monthly', 'lifetime')),
  used_minutes numeric(12, 2) NOT NULL DEFAULT 0 CHECK (used_minutes >= 0),
  period_started_at timestamptz NOT NULL DEFAULT date_trunc('month', now() AT TIME ZONE 'UTC'),
  is_active boolean NOT NULL DEFAULT true,
  notes text NULL,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_grants_scope ON public.ai_grants (scope_type, scope_id) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 4) Owner-delegated AI admins (future developers — owner assigns explicitly)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_admin_delegates (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  can_manage_grants boolean NOT NULL DEFAULT true,
  can_manage_providers boolean NOT NULL DEFAULT false,
  can_view_usage boolean NOT NULL DEFAULT true,
  granted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5) Usage events (immutable audit + quota rollup source)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NULL REFERENCES public.ai_grants(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  branch_assignment_id uuid NULL REFERENCES public.company_branch_assignments(id) ON DELETE SET NULL,
  provider_code text NOT NULL REFERENCES public.ai_providers(code),
  model text NOT NULL,
  assistant_kind text NOT NULL
    CHECK (assistant_kind IN ('employee', 'manager', 'platform_owner')),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_grant ON public.ai_usage_events (grant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user ON public.ai_usage_events (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6) Platform-level settings (default provider + owner assistant quota)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_platform_settings (
  platform_id uuid PRIMARY KEY REFERENCES public.platforms(id) ON DELETE CASCADE,
  default_provider_code text NOT NULL REFERENCES public.ai_providers(code) DEFAULT 'gemini',
  owner_monthly_minutes integer NULL CHECK (owner_monthly_minutes IS NULL OR owner_monthly_minutes >= 0),
  owner_used_minutes numeric(12, 2) NOT NULL DEFAULT 0 CHECK (owner_used_minutes >= 0),
  owner_period_started_at timestamptz NOT NULL DEFAULT date_trunc('month', now() AT TIME ZONE 'UTC'),
  is_globally_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_ai_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.ai_admin_delegates d WHERE d.user_id = _user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_ai_grants(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.ai_admin_delegates d
      WHERE d.user_id = _user_id AND d.can_manage_grants = true
    );
$$;

-- Resolve branch assignment for an operational profile branch_id.
CREATE OR REPLACE FUNCTION public.resolve_branch_assignment_id(_source_branch_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cba.id
  FROM public.company_branch_assignments cba
  WHERE cba.source_branch_id = _source_branch_id
    AND cba.deleted_at IS NULL
    AND cba.is_active = true
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 8) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_admin_delegates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_platform_settings ENABLE ROW LEVEL SECURITY;

-- Providers & entitlements: readable by authenticated; writable by AI admins
CREATE POLICY ai_providers_select ON public.ai_providers FOR SELECT TO authenticated USING (true);
CREATE POLICY ai_providers_write ON public.ai_providers FOR ALL TO authenticated
  USING (public.can_manage_ai_grants(auth.uid()))
  WITH CHECK (public.can_manage_ai_grants(auth.uid()));

CREATE POLICY ai_plan_entitlements_select ON public.ai_plan_entitlements FOR SELECT TO authenticated USING (true);
CREATE POLICY ai_plan_entitlements_write ON public.ai_plan_entitlements FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

CREATE POLICY ai_grants_select ON public.ai_grants FOR SELECT TO authenticated
  USING (public.can_manage_ai_grants(auth.uid()));
CREATE POLICY ai_grants_write ON public.ai_grants FOR ALL TO authenticated
  USING (public.can_manage_ai_grants(auth.uid()))
  WITH CHECK (public.can_manage_ai_grants(auth.uid()));

CREATE POLICY ai_admin_delegates_select ON public.ai_admin_delegates FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()) OR user_id = auth.uid());
CREATE POLICY ai_admin_delegates_write ON public.ai_admin_delegates FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

CREATE POLICY ai_usage_events_select ON public.ai_usage_events FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_platform_owner(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ai_admin_delegates d
      WHERE d.user_id = auth.uid() AND d.can_view_usage = true
    )
  );
CREATE POLICY ai_usage_events_insert ON public.ai_usage_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY ai_platform_settings_select ON public.ai_platform_settings FOR SELECT TO authenticated
  USING (public.is_ai_admin(auth.uid()));
CREATE POLICY ai_platform_settings_write ON public.ai_platform_settings FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

-- ---------------------------------------------------------------------------
-- 9) Grants
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.ai_providers TO authenticated;
GRANT SELECT ON public.ai_plan_entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_grants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_admin_delegates TO authenticated;
GRANT SELECT, INSERT ON public.ai_usage_events TO authenticated;
GRANT SELECT, UPDATE ON public.ai_platform_settings TO authenticated;

GRANT ALL ON public.ai_providers TO service_role;
GRANT ALL ON public.ai_plan_entitlements TO service_role;
GRANT ALL ON public.ai_grants TO service_role;
GRANT ALL ON public.ai_admin_delegates TO service_role;
GRANT ALL ON public.ai_usage_events TO service_role;
GRANT ALL ON public.ai_platform_settings TO service_role;

GRANT EXECUTE ON FUNCTION public.is_ai_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_ai_grants(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_branch_assignment_id(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10) Resolve access + quota consumption (SECURITY DEFINER — users see only self)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_ai_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  prof record;
  grant_row record;
  ent record;
  assignment_id uuid;
  company_id uuid;
  default_provider text;
  globally_enabled boolean;
  owner_limit integer;
  owner_used numeric;
  owner_period timestamptz;
  assistant text;
  remaining numeric;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  SELECT default_provider_code, is_globally_enabled, owner_monthly_minutes, owner_used_minutes, owner_period_started_at
  INTO default_provider, globally_enabled, owner_limit, owner_used, owner_period
  FROM public.ai_platform_settings
  LIMIT 1;

  IF default_provider IS NULL THEN
    default_provider := 'gemini';
  END IF;

  IF globally_enabled IS FALSE THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'globally_disabled');
  END IF;

  IF public.is_platform_owner(uid) THEN
    IF owner_period IS NULL OR date_trunc('month', owner_period AT TIME ZONE 'UTC') < date_trunc('month', now() AT TIME ZONE 'UTC') THEN
      owner_used := 0;
    END IF;
    remaining := CASE WHEN owner_limit IS NULL THEN NULL ELSE GREATEST(0, owner_limit - owner_used) END;
    IF owner_limit IS NOT NULL AND owner_used >= owner_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exhausted', 'assistant_kind', 'platform_owner');
    END IF;
    RETURN jsonb_build_object(
      'allowed', true,
      'assistant_kind', 'platform_owner',
      'provider_code', default_provider,
      'grant_id', NULL,
      'remaining_minutes', remaining,
      'quota_minutes', owner_limit,
      'grant_source', 'platform'
    );
  END IF;

  SELECT p.branch_id
  INTO prof
  FROM public.profiles p
  WHERE p.id = uid;

  IF public.has_role(uid, 'branch_manager'::public.app_role)
     OR public.has_role(uid, 'assistant_manager'::public.app_role)
     OR public.has_role(uid, 'department_manager'::public.app_role) THEN
    assistant := 'manager';
  ELSE
    assistant := 'employee';
  END IF;

  -- user grant
  SELECT * INTO grant_row FROM public.ai_grants
  WHERE scope_type = 'user' AND scope_id = uid AND is_active = true
  LIMIT 1;

  IF grant_row IS NULL AND prof.branch_id IS NOT NULL THEN
    assignment_id := public.resolve_branch_assignment_id(prof.branch_id);
    IF assignment_id IS NOT NULL THEN
      SELECT * INTO grant_row FROM public.ai_grants
      WHERE scope_type = 'branch' AND scope_id = assignment_id AND is_active = true
      LIMIT 1;
      IF grant_row IS NULL THEN
        SELECT cba.company_id INTO company_id
        FROM public.company_branch_assignments cba
        WHERE cba.id = assignment_id;
        IF company_id IS NOT NULL THEN
          SELECT * INTO grant_row FROM public.ai_grants
          WHERE scope_type = 'company' AND scope_id = company_id AND is_active = true
          LIMIT 1;
        END IF;
      END IF;
    END IF;
  END IF;

  IF grant_row IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_grant', 'assistant_kind', assistant);
  END IF;

  IF grant_row.quota_period = 'monthly'
     AND date_trunc('month', grant_row.period_started_at AT TIME ZONE 'UTC') < date_trunc('month', now() AT TIME ZONE 'UTC') THEN
    grant_row.used_minutes := 0;
  END IF;

  remaining := CASE
    WHEN grant_row.quota_minutes IS NULL THEN NULL
    ELSE GREATEST(0, grant_row.quota_minutes - grant_row.used_minutes)
  END;

  IF grant_row.quota_minutes IS NOT NULL AND grant_row.used_minutes >= grant_row.quota_minutes THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exhausted', 'assistant_kind', assistant);
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'assistant_kind', assistant,
    'provider_code', COALESCE(grant_row.provider_code, default_provider),
    'grant_id', grant_row.id,
    'remaining_minutes', remaining,
    'quota_minutes', grant_row.quota_minutes,
    'grant_source', grant_row.grant_source
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_ai_minutes(
  _grant_id uuid,
  _minutes numeric,
  _provider_code text,
  _model text,
  _assistant_kind text,
  _input_tokens integer DEFAULT 0,
  _output_tokens integer DEFAULT 0,
  _duration_ms integer DEFAULT 0,
  _company_id uuid DEFAULT NULL,
  _branch_assignment_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF _grant_id IS NULL THEN
    UPDATE public.ai_platform_settings
    SET owner_used_minutes = owner_used_minutes + COALESCE(_minutes, 0),
        updated_at = now()
    WHERE platform_id IN (SELECT id FROM public.platforms LIMIT 1);
  ELSE
    UPDATE public.ai_grants
    SET used_minutes = used_minutes + COALESCE(_minutes, 0),
        updated_at = now()
    WHERE id = _grant_id;
  END IF;

  INSERT INTO public.ai_usage_events (
    grant_id, user_id, company_id, branch_assignment_id,
    provider_code, model, assistant_kind,
    input_tokens, output_tokens, duration_ms
  ) VALUES (
    _grant_id, uid, _company_id, _branch_assignment_id,
    _provider_code, _model, _assistant_kind,
    COALESCE(_input_tokens, 0), COALESCE(_output_tokens, 0), COALESCE(_duration_ms, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_ai_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_minutes(uuid, numeric, text, text, text, integer, integer, integer, uuid, uuid) TO authenticated, service_role;

-- Seed platform AI settings for the default platform row (if present).
INSERT INTO public.ai_platform_settings (platform_id, default_provider_code, owner_monthly_minutes, is_globally_enabled)
SELECT p.id, 'gemini', NULL, true
FROM public.platforms p
ORDER BY p.created_at
LIMIT 1
ON CONFLICT (platform_id) DO NOTHING;
