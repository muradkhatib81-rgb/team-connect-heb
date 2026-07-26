-- Fix stale used_days: cancel orphaned approved leaves when profile is not on leave,
-- then rebuild used_days / reserved_days from remaining requests.
-- No permission / RLS changes.

-- 1) Cancel approved leave/extension still open while profile.on_leave = false
UPDATE public.leave_requests lr
SET
  status = 'cancelled',
  admin_note = COALESCE(
    NULLIF(btrim(lr.admin_note), ''),
    'בוטל — תיקון סנכרון (העובד לא מסומן בחופשה)'
  ),
  admin_decided_at = COALESCE(lr.admin_decided_at, now()),
  admin_decider_name = COALESCE(NULLIF(btrim(lr.admin_decider_name), ''), 'מערכת'),
  updated_at = now()
FROM public.profiles p
WHERE lr.user_id = p.id
  AND COALESCE(p.on_leave, false) = false
  AND lr.status = 'approved'
  AND lr.kind IN ('leave', 'extension')
  AND lr.end_date >= (timezone('Asia/Jerusalem', now()))::date;

-- 2) Rebuild counters from source of truth
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
