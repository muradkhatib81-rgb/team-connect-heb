CREATE TABLE IF NOT EXISTS public.break_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  break_request_id uuid NOT NULL REFERENCES public.break_requests(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('manual_end')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE
);

GRANT SELECT ON public.break_audit_log TO authenticated;
GRANT ALL ON public.break_audit_log TO service_role;

ALTER TABLE public.break_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_break_audit_log_request ON public.break_audit_log(break_request_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_break_audit_log_actor ON public.break_audit_log(actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_break_audit_log_target ON public.break_audit_log(target_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_break_audit_log_branch ON public.break_audit_log(branch_id, occurred_at DESC);

DROP POLICY IF EXISTS "Break audit managers view" ON public.break_audit_log;
CREATE POLICY "Break audit managers view"
ON public.break_audit_log
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'system_admin'::public.app_role)
  OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.user_task_permissions p
    WHERE p.user_id = auth.uid()
      AND p.can_manage_breaks = true
  )
);

CREATE OR REPLACE FUNCTION public.can_manually_end_break(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND (
      public.has_role(_user_id, 'system_admin'::public.app_role)
      OR public.has_role(_user_id, 'main_admin'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.user_task_permissions p
        WHERE p.user_id = _user_id
          AND p.can_manage_breaks = true
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_manually_end_break(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manually_end_break(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manual_end_break(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_completed_at timestamptz := now();
  v_started_at timestamptz;
  v_actual_minutes integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;

  IF NOT public.can_manually_end_break(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לסיים הפסקה של עובד';
  END IF;

  SELECT * INTO r
  FROM public.break_requests
  WHERE id = _id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפסקה לא נמצאה';
  END IF;

  IF r.status <> 'active' THEN
    RAISE EXCEPTION 'ניתן לסיים ידנית רק הפסקה פעילה';
  END IF;

  v_started_at := COALESCE(r.started_at, r.approved_at_time, r.requested_at, v_completed_at);
  v_actual_minutes := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_completed_at - v_started_at)) / 60.0)::integer);

  UPDATE public.break_requests
     SET status = 'completed',
         started_at = v_started_at,
         completed_at = v_completed_at,
         completed_by = v_actor,
         end_notified_at = COALESCE(end_notified_at, v_completed_at)
   WHERE id = _id;

  INSERT INTO public.break_audit_log (
    break_request_id,
    actor_id,
    target_user_id,
    action,
    payload,
    branch_id
  ) VALUES (
    _id,
    v_actor,
    r.user_id,
    'manual_end',
    jsonb_build_object(
      'previous_status', r.status,
      'new_status', 'completed',
      'started_at', v_started_at,
      'scheduled_ends_at', r.ends_at,
      'completed_at', v_completed_at,
      'actual_duration_minutes', v_actual_minutes
    ),
    r.branch_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.manual_end_break(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_end_break(uuid) TO authenticated, service_role;