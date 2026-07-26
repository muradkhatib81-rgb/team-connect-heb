-- Repair leave balance counters after cancels that cleared profile but left used_days.
-- Source of truth: approved leave/extension requests → used_days;
-- pending leave/extension requests → reserved_days.
-- No permission / RLS changes.

UPDATE public.leave_balances lb
SET
  used_days = COALESCE((
    SELECT SUM(lr.days_count)::numeric
    FROM public.leave_requests lr
    WHERE lr.user_id = lb.user_id
      AND lr.leave_type_id = lb.leave_type_id
      AND lr.status = 'approved'
      AND lr.kind IN ('leave', 'extension')
  ), 0),
  reserved_days = COALESCE((
    SELECT SUM(lr.days_count)::numeric
    FROM public.leave_requests lr
    WHERE lr.user_id = lb.user_id
      AND lr.leave_type_id = lb.leave_type_id
      AND lr.status IN ('pending_dept', 'pending_admin')
      AND lr.kind IN ('leave', 'extension')
  ), 0),
  updated_at = now();

NOTIFY pgrst, 'reload schema';
