-- Platform owners must see leave history even without x-active-branch.
-- Restrictive branch policies previously required branch_id = current_active_branch(),
-- which is NULL for owners without a selected branch → empty history.
-- Also allow platform owners to hard-delete leave_requests (history purge).

-- ========== Branch scope: owner bypass ==========
DROP POLICY IF EXISTS leave_types_branch_scope ON public.leave_types;
CREATE POLICY leave_types_branch_scope ON public.leave_types AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  );

DROP POLICY IF EXISTS leave_accrual_branch_scope ON public.leave_accrual_rules;
CREATE POLICY leave_accrual_branch_scope ON public.leave_accrual_rules AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  );

DROP POLICY IF EXISTS leave_balances_branch_scope ON public.leave_balances;
CREATE POLICY leave_balances_branch_scope ON public.leave_balances AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  );

DROP POLICY IF EXISTS leave_adj_branch_scope ON public.leave_balance_adjustments;
CREATE POLICY leave_adj_branch_scope ON public.leave_balance_adjustments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  );

DROP POLICY IF EXISTS leave_requests_branch_scope ON public.leave_requests;
CREATE POLICY leave_requests_branch_scope ON public.leave_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  );

DROP POLICY IF EXISTS leave_attach_branch_scope ON public.leave_request_attachments;
CREATE POLICY leave_attach_branch_scope ON public.leave_request_attachments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  );

DROP POLICY IF EXISTS leave_audit_branch_scope ON public.leave_audit_log;
CREATE POLICY leave_audit_branch_scope ON public.leave_audit_log AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR branch_id = public.current_active_branch()
  );

-- ========== Hard delete for platform owners only ==========
GRANT DELETE ON public.leave_requests TO authenticated;

DROP POLICY IF EXISTS leave_requests_delete ON public.leave_requests;
CREATE POLICY leave_requests_delete ON public.leave_requests
  FOR DELETE TO authenticated
  USING (public.is_platform_owner(auth.uid()));

-- Audit trail for history purge
CREATE OR REPLACE FUNCTION public.purge_leave_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.leave_requests%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  IF NOT public.is_platform_owner(v_actor) THEN
    RAISE EXCEPTION 'רק בעל המערכת יכול למחוק בקשות חופשה מההיסטוריה';
  END IF;

  SELECT * INTO r FROM public.leave_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.write_leave_audit(
    'request_purged',
    _request_id,
    r.user_id,
    jsonb_build_object(
      'kind', r.kind::text,
      'status', r.status::text,
      'start_date', r.start_date,
      'end_date', r.end_date,
      'days_count', r.days_count,
      'leave_type_id', r.leave_type_id
    ),
    r.branch_id
  );

  DELETE FROM public.leave_requests WHERE id = _request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_leave_request(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
