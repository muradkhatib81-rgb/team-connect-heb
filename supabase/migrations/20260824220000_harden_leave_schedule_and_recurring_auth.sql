-- Harden leave schedule helpers + leave_requests UPDATE.
-- Does NOT alter user_roles, user_task_permissions, push, or business workflows.
-- decide_leave_* / admin_cancel_* remain SECURITY DEFINER and still call these helpers.

-- ---------------------------------------------------------------------------
-- 1) Schedule leave helpers: only callable by service_role / other definers
--    (not directly by authenticated clients via PostgREST)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_leave_from_schedule_shifts(uuid, date, date, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_leave_from_schedule_shifts(uuid, date, date, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2) leave_requests UPDATE: requesters cannot self-update status/fields.
--    Status changes go through decide_leave_* / admin_cancel_* (SECURITY DEFINER).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leave_requests_update ON public.leave_requests;
CREATE POLICY leave_requests_update ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (
    public.has_leave_perm(auth.uid(), 'approve')
    OR public.has_leave_perm(auth.uid(), 'reject')
    OR public.is_dept_manager_of(auth.uid(), department_id)
    OR public.is_platform_owner(auth.uid())
  )
  WITH CHECK (
    public.has_leave_perm(auth.uid(), 'approve')
    OR public.has_leave_perm(auth.uid(), 'reject')
    OR public.is_dept_manager_of(auth.uid(), department_id)
    OR public.is_platform_owner(auth.uid())
  );
