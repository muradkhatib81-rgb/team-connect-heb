-- Idempotent fix: safe to re-run if 20260816003000 partially applied.
-- Drops AI RLS policies before recreating them; functions use CREATE OR REPLACE.

-- Policies (drop if exist, then recreate)
DROP POLICY IF EXISTS ai_providers_select ON public.ai_providers;
DROP POLICY IF EXISTS ai_providers_write ON public.ai_providers;
DROP POLICY IF EXISTS ai_plan_entitlements_select ON public.ai_plan_entitlements;
DROP POLICY IF EXISTS ai_plan_entitlements_write ON public.ai_plan_entitlements;
DROP POLICY IF EXISTS ai_grants_select ON public.ai_grants;
DROP POLICY IF EXISTS ai_grants_write ON public.ai_grants;
DROP POLICY IF EXISTS ai_admin_delegates_select ON public.ai_admin_delegates;
DROP POLICY IF EXISTS ai_admin_delegates_write ON public.ai_admin_delegates;
DROP POLICY IF EXISTS ai_usage_events_select ON public.ai_usage_events;
DROP POLICY IF EXISTS ai_usage_events_insert ON public.ai_usage_events;
DROP POLICY IF EXISTS ai_platform_settings_select ON public.ai_platform_settings;
DROP POLICY IF EXISTS ai_platform_settings_write ON public.ai_platform_settings;

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

-- Ensure functions exist (full bodies from main migration)
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

  SELECT p.branch_id INTO prof FROM public.profiles p WHERE p.id = uid;

  IF public.has_role(uid, 'branch_manager'::public.app_role)
     OR public.has_role(uid, 'assistant_manager'::public.app_role)
     OR public.has_role(uid, 'department_manager'::public.app_role) THEN
    assistant := 'manager';
  ELSE
    assistant := 'employee';
  END IF;

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

INSERT INTO public.ai_platform_settings (platform_id, default_provider_code, owner_monthly_minutes, is_globally_enabled)
SELECT p.id, 'gemini', NULL, true
FROM public.platforms p
ORDER BY p.created_at
LIMIT 1
ON CONFLICT (platform_id) DO NOTHING;
