
-- =========================================================================
-- STAGE 1 — Platform Owner Foundation (additive only, no behavior change)
-- =========================================================================
-- 1) Business predicate: is_platform_owner
-- 2) Additive protection triggers on user_roles (grant/mutation guards)
-- 3) platform_owner_audit_log table + GRANTs + RLS + writer function
--
-- Nothing here modifies existing policies, functions, columns, or data.
-- =========================================================================

-- ---------- 1) Business predicate --------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('system_admin'::public.app_role, 'main_admin'::public.app_role)
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_owner(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.is_platform_owner(uuid) IS
'Business-layer predicate. True when the user is a Platform Owner (Primary or Owner). Single source of truth — every employee-facing surface must filter through this function. Internal role names are implementation details and must not appear elsewhere.';


-- ---------- 2) Additive protection triggers on user_roles ---------------
-- Guard: only a system_admin may grant system_admin or main_admin.
-- Skipped when auth.uid() is NULL (initial bootstrap / handle_new_user
-- runs in a definer context where auth.uid() may be null, and the very
-- first user must still receive main_admin).
CREATE OR REPLACE FUNCTION public.guard_platform_owner_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.role NOT IN ('system_admin'::public.app_role, 'main_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Allow system-level bootstrap (no auth context, e.g. seed/first user).
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_system_admin(v_actor) THEN
    RAISE EXCEPTION 'רק בעל המערכת הראשי רשאי להעניק הרשאות בעלות מערכת';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_platform_owner_grant ON public.user_roles;
CREATE TRIGGER trg_guard_platform_owner_grant
BEFORE INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_platform_owner_grant();


-- Guard: a main_admin may not mutate/remove a system_admin row.
CREATE OR REPLACE FUNCTION public.guard_platform_owner_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target_role public.app_role;
BEGIN
  v_target_role := COALESCE(OLD.role, NEW.role);

  IF v_target_role <> 'system_admin'::public.app_role THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT public.is_system_admin(v_actor) THEN
    RAISE EXCEPTION 'רק בעל המערכת הראשי רשאי לשנות את הרשאות בעל המערכת הראשי';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_platform_owner_mutation ON public.user_roles;
CREATE TRIGGER trg_guard_platform_owner_mutation
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_platform_owner_mutation();


-- ---------- 3) Platform owner audit log --------------------------------
CREATE TABLE IF NOT EXISTS public.platform_owner_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event          text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pola_created_at ON public.platform_owner_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pola_actor      ON public.platform_owner_audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_pola_target     ON public.platform_owner_audit_log (target_user_id);
CREATE INDEX IF NOT EXISTS idx_pola_event      ON public.platform_owner_audit_log (event);

GRANT SELECT ON public.platform_owner_audit_log TO authenticated;
GRANT ALL    ON public.platform_owner_audit_log TO service_role;

ALTER TABLE public.platform_owner_audit_log ENABLE ROW LEVEL SECURITY;

-- Only Platform Owners may read the audit log.
DROP POLICY IF EXISTS "Platform owners can read audit log"
  ON public.platform_owner_audit_log;
CREATE POLICY "Platform owners can read audit log"
  ON public.platform_owner_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_platform_owner(auth.uid()));

-- Writes go exclusively through log_platform_owner_event (SECURITY DEFINER).
-- No INSERT/UPDATE/DELETE policy => direct writes are blocked for all roles.

CREATE OR REPLACE FUNCTION public.log_platform_owner_event(
  _event          text,
  _target_user_id uuid DEFAULT NULL,
  _payload        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.platform_owner_audit_log (actor_id, target_user_id, event, payload)
  VALUES (auth.uid(), _target_user_id, _event, COALESCE(_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_platform_owner_event(text, uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_platform_owner_event(text, uuid, jsonb) TO authenticated, service_role;
