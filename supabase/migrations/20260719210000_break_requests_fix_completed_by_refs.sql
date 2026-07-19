-- break_requests no longer has completed_by; audit uses end_verified_by / ending_verified_at.
-- Recreate break functions so INSERT and end flows match the current table schema.

ALTER TABLE public.break_requests
  DROP COLUMN IF EXISTS completed_by;

ALTER TABLE public.break_requests
  ADD COLUMN IF NOT EXISTS end_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ending_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamptz;

COMMENT ON COLUMN public.break_requests.end_verified_by IS
  'User who verified/ended the break (employee self-return or manager force-return).';
COMMENT ON COLUMN public.break_requests.ending_verified_at IS
  'Timestamp when the break end was verified.';
COMMENT ON COLUMN public.break_requests.last_modified_at IS
  'Last time break request workflow fields were modified.';

-- Backfill end verification from legacy audit fields when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'break_requests' AND column_name = 'ended_by'
  ) THEN
    UPDATE public.break_requests
    SET end_verified_by = COALESCE(end_verified_by, ended_by_manager_id),
        ending_verified_at = COALESCE(ending_verified_at, completed_at),
        last_modified_at = COALESCE(last_modified_at, completed_at)
    WHERE end_verified_by IS NULL
      AND ended_by = 'manager'
      AND ended_by_manager_id IS NOT NULL
      AND completed_at IS NOT NULL;

    UPDATE public.break_requests
    SET end_verified_by = COALESCE(end_verified_by, user_id),
        ending_verified_at = COALESCE(ending_verified_at, completed_at),
        last_modified_at = COALESCE(last_modified_at, completed_at)
    WHERE end_verified_by IS NULL
      AND ended_by = 'employee'
      AND status::text IN ('completed', 'ended_by_manager')
      AND completed_at IS NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.break_policy;
BEGIN
  NEW.started_at := NULL;
  NEW.ends_at := NULL;
  NEW.completed_at := NULL;
  NEW.end_verified_by := NULL;
  NEW.ending_verified_at := NULL;
  NEW.last_modified_at := now();

  p := public.get_break_policy();

  IF p.requires_approval = false THEN
    NEW.status := 'approved';
    NEW.approved_at_time := COALESCE(NEW.approved_at_time, NEW.requested_at);
    NEW.approved_by := COALESCE(NEW.approved_by, NEW.user_id);
    NEW.approval_decided_at := COALESCE(NEW.approval_decided_at, now());
  ELSE
    IF NEW.status NOT IN ('pending', 'cancelled') THEN
      NEW.status := 'pending';
    END IF;
    NEW.approved_at_time := NULL;
    NEW.approved_by := NULL;
    NEW.approval_decided_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_my_break(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_end timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'בקשה לא נמצאה';
  END IF;
  IF r.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  IF r.status <> 'active' THEN
    RAISE EXCEPTION 'אין הפסקה פעילה לסיום';
  END IF;

  UPDATE public.break_requests
     SET status = 'completed',
         started_at = COALESCE(started_at, approved_at_time, requested_at, v_end),
         completed_at = v_end,
         end_verified_by = auth.uid(),
         ending_verified_at = v_end,
         last_modified_at = v_end,
         end_notified_at = COALESCE(end_notified_at, v_end)
   WHERE id = _id;
END;
$$;

-- Remove legacy single-argument overload that still referenced completed_by.
DROP FUNCTION IF EXISTS public.manual_end_break(uuid);

CREATE OR REPLACE FUNCTION public.manual_end_break(
  _id uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_end timestamptz := now();
  v_started timestamptz;
  v_actual_minutes integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  IF NOT public.can_manually_end_break(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לסיים הפסקה של עובד';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפסקה לא נמצאה';
  END IF;
  IF r.status <> 'active' THEN
    RAISE EXCEPTION 'ניתן לסיים ידנית רק הפסקה פעילה';
  END IF;

  v_started := COALESCE(r.started_at, r.approved_at_time, r.requested_at, v_end);
  v_actual_minutes := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_end - v_started)) / 60.0)::integer);

  UPDATE public.break_requests
     SET status = 'ended_by_manager',
         started_at = v_started,
         completed_at = v_end,
         end_verified_by = v_actor,
         ending_verified_at = v_end,
         last_modified_at = v_end,
         end_notified_at = COALESCE(end_notified_at, v_end)
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
      'new_status', 'ended_by_manager',
      'started_at', v_started,
      'scheduled_ends_at', r.ends_at,
      'completed_at', v_end,
      'actual_duration_minutes', v_actual_minutes,
      'reason', NULLIF(btrim(_reason), '')
    ),
    r.branch_id
  );

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, 'ההפסקה הסתיימה על ידי מנהל', r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.end_my_break(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_my_break(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.manual_end_break(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_end_break(uuid, text) TO authenticated, service_role;

-- Sanity check: no break-related functions should reference completed_by on break_requests.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND (
      p.proname LIKE '%break%'
      OR pg_get_functiondef(p.oid) ILIKE '%break_requests%'
    )
    AND pg_get_functiondef(p.oid) ILIKE '%completed_by%';

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Break-related functions still reference completed_by (% found)', bad_count;
  END IF;
END $$;
