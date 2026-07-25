-- Leave balance edits are not automatic for branch_manager.
-- Approve/view/reject remain role-based for branch managers.
-- can_edit_leave_balance must be granted (assistant or branch manager row).

CREATE OR REPLACE FUNCTION public.has_leave_perm(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN _user_id IS NULL THEN false

      -- Platform owners: full leave authority including balance
      WHEN public.has_role(_user_id, 'system_admin'::public.app_role)
        OR public.has_role(_user_id, 'main_admin'::public.app_role)
      THEN true

      -- Balance / leave-system edits: explicit grant only (BM or assistant)
      WHEN _perm = 'balance' THEN EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = _user_id
          AND p.can_edit_leave_balance = true
          AND (
            public.has_role(_user_id, 'branch_manager'::public.app_role)
            OR public.has_role(_user_id, 'assistant_manager'::public.app_role)
          )
      )

      -- View / approve / reject: branch manager by role
      WHEN public.has_role(_user_id, 'branch_manager'::public.app_role) THEN true

      -- Assistants: granular leave grants
      WHEN public.has_role(_user_id, 'assistant_manager'::public.app_role) THEN EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = _user_id
          AND (
            (_perm = 'view' AND (p.can_view_leave OR p.can_approve_leave OR p.can_reject_leave OR p.can_edit_leave_balance))
            OR (_perm = 'approve' AND p.can_approve_leave)
            OR (_perm = 'reject' AND p.can_reject_leave)
          )
      )

      ELSE false
    END;
$$;
