-- Make the existing schedule view/edit toggles effective.
-- No role, grant row, or branch assignment is changed.

CREATE OR REPLACE FUNCTION public.has_schedule_workflow_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_task_permissions permission
    WHERE permission.user_id = _user_id
      AND (
        permission.can_view_schedule
        OR permission.can_create_schedule
        OR permission.can_edit_schedule
        OR permission.can_manage_schedule
        OR permission.can_approve_schedule
        OR permission.can_publish_schedule
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_schedule_edit_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND (permission.can_edit_schedule OR permission.can_manage_schedule)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_schedule_department(
  _user_id uuid,
  _department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND public.has_schedule_workflow_perm(_user_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.profile_scope_internal(_user_id) profile
      WHERE profile.department_id = _department_id
    );
$$;

DROP POLICY IF EXISTS schedules_update ON public.schedules;
CREATE POLICY schedules_update ON public.schedules
FOR UPDATE TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  OR public.has_schedule_approve_perm(auth.uid())
  OR public.has_schedule_publish_perm(auth.uid())
  OR (
    public.has_schedule_edit_perm(auth.uid())
    AND status = ANY (ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status])
  )
  OR (
    public.has_role(auth.uid(), 'department_manager'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles profile
      WHERE profile.id = auth.uid()
        AND profile.department_id = schedules.department_id
    )
    AND status = ANY (
      ARRAY[
        'draft'::public.schedule_status,
        'rejected'::public.schedule_status,
        'pending_approval'::public.schedule_status
      ]
    )
  )
  OR (
    created_by = auth.uid()
    AND status = ANY (ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status])
  )
)
WITH CHECK (
  public.is_platform_owner(auth.uid())
  OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  OR public.has_schedule_approve_perm(auth.uid())
  OR public.has_schedule_publish_perm(auth.uid())
  OR (
    public.has_schedule_edit_perm(auth.uid())
    AND status = ANY (ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status])
  )
  OR (
    public.has_role(auth.uid(), 'department_manager'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles profile
      WHERE profile.id = auth.uid()
        AND profile.department_id = schedules.department_id
    )
    AND status = ANY (
      ARRAY[
        'draft'::public.schedule_status,
        'rejected'::public.schedule_status,
        'pending_approval'::public.schedule_status
      ]
    )
  )
  OR (
    created_by = auth.uid()
    AND status = ANY (
      ARRAY[
        'draft'::public.schedule_status,
        'rejected'::public.schedule_status,
        'pending_approval'::public.schedule_status
      ]
    )
  )
);

DROP POLICY IF EXISTS schedules_delete ON public.schedules;
CREATE POLICY schedules_delete ON public.schedules
FOR DELETE TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  OR public.has_schedule_publish_perm(auth.uid())
  OR public.has_schedule_approve_perm(auth.uid())
  OR (
    public.has_schedule_edit_perm(auth.uid())
    AND status = ANY (ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status])
  )
  OR (
    public.has_role(auth.uid(), 'department_manager'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles profile
      WHERE profile.id = auth.uid()
        AND profile.department_id = schedules.department_id
    )
    AND status = ANY (ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status])
  )
  OR (
    created_by = auth.uid()
    AND status = ANY (ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status])
  )
);

DROP POLICY IF EXISTS shifts_write ON public.schedule_shifts;
CREATE POLICY shifts_write ON public.schedule_shifts
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.schedules schedule
    WHERE schedule.id = schedule_shifts.schedule_id
      AND (
        public.is_platform_owner(auth.uid())
        OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
        OR public.has_schedule_publish_perm(auth.uid())
        OR (
          public.has_schedule_approve_perm(auth.uid())
          AND schedule.status = 'pending_approval'::public.schedule_status
        )
        OR (
          public.has_schedule_edit_perm(auth.uid())
          AND schedule.status = ANY (
            ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status]
          )
        )
        OR (
          public.has_role(auth.uid(), 'department_manager'::public.app_role)
          AND EXISTS (
            SELECT 1 FROM public.profiles profile
            WHERE profile.id = auth.uid()
              AND profile.department_id = schedule.department_id
          )
          AND schedule.status = ANY (
            ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status]
          )
        )
        OR (
          schedule.created_by = auth.uid()
          AND schedule.status = ANY (
            ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status]
          )
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.schedules schedule
    WHERE schedule.id = schedule_shifts.schedule_id
      AND (
        public.is_platform_owner(auth.uid())
        OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
        OR public.has_schedule_publish_perm(auth.uid())
        OR (
          public.has_schedule_approve_perm(auth.uid())
          AND schedule.status = 'pending_approval'::public.schedule_status
        )
        OR (
          public.has_schedule_edit_perm(auth.uid())
          AND schedule.status = ANY (
            ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status]
          )
        )
        OR (
          public.has_role(auth.uid(), 'department_manager'::public.app_role)
          AND EXISTS (
            SELECT 1 FROM public.profiles profile
            WHERE profile.id = auth.uid()
              AND profile.department_id = schedule.department_id
          )
          AND schedule.status = ANY (
            ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status]
          )
        )
        OR (
          schedule.created_by = auth.uid()
          AND schedule.status = ANY (
            ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status]
          )
        )
      )
  )
);

NOTIFY pgrst, 'reload schema';
