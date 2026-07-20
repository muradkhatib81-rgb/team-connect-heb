-- Roll back 20260720180000_validate_break_request_shift_quotas.sql.
-- Restore break_requests_apply_policy() to the 20260720110000 definition and
-- remove quota-validation helpers that are no longer referenced.

CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.break_policy;
  v_branch uuid;
BEGIN
  NEW.planned_start := COALESCE(NEW.planned_start, NEW.requested_at);
  NEW.planned_duration := COALESCE(NEW.planned_duration, NEW.duration_minutes);
  NEW.duration_minutes := COALESCE(NEW.duration_minutes, NEW.planned_duration);
  NEW.requested_at := NEW.planned_start;

  SELECT COALESCE(pr.branch_id, d.branch_id)
    INTO v_branch
    FROM public.profiles pr
    LEFT JOIN public.departments d ON d.id = COALESCE(NEW.department_id, pr.department_id)
   WHERE pr.id = NEW.user_id;

  NEW.branch_id := v_branch;

  PERFORM public.validate_break_request_times(NEW.user_id, NEW.planned_start, NEW.planned_duration, NULL);

  NEW.started_at := NULL;
  NEW.ends_at := NULL;
  NEW.completed_at := NULL;
  NEW.end_verified_by := NULL;
  NEW.ending_verified_at := NULL;
  NEW.last_modified_at := now();
  NEW.actual_start := NULL;
  NEW.actual_end := NULL;
  NEW.actual_duration := NULL;
  NEW.overtime_minutes := NULL;
  NEW.ended_by := NULL;
  NEW.ended_by_manager_id := NULL;
  NEW.ended_by_manager_name := NULL;

  p := public.get_break_policy();

  IF p.requires_approval = false THEN
    NEW.status := 'scheduled'::public.break_request_status;
    NEW.approved_at_time := COALESCE(NEW.approved_at_time, NEW.planned_start);
    NEW.approved_by := COALESCE(NEW.approved_by, NEW.user_id);
    NEW.approval_decided_at := COALESCE(NEW.approval_decided_at, now());
  ELSE
    NEW.status := 'pending_approval'::public.break_request_status;
    NEW.approved_at_time := NULL;
    NEW.approved_by := NULL;
    NEW.approval_decided_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.validate_break_request_shift_quotas(uuid, uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.count_shift_scheduled_breaks(uuid, timestamptz, timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS public.count_shift_break_inserts_in_current_txn(uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.count_shift_blocking_breaks(uuid, timestamptz, timestamptz, uuid, uuid);
