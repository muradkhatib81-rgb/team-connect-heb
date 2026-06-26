
-- Allow creators (e.g. branch_manager / assistant_manager with can_create_schedule)
-- to SELECT, UPDATE and write shifts for the drafts they create.
-- Department-manager scoping is preserved unchanged.

DROP POLICY IF EXISTS schedules_select ON public.schedules;
CREATE POLICY schedules_select ON public.schedules
FOR SELECT
USING (
  (has_role(auth.uid(), 'department_manager'::app_role)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id))
  OR (
    (has_role(auth.uid(), 'main_admin'::app_role)
      OR has_schedule_approve_perm(auth.uid())
      OR has_schedule_publish_perm(auth.uid()))
    AND status <> ALL (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
  )
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.department_id = schedules.department_id
      AND schedules.status = 'approved'::schedule_status
  )
  -- NEW: creator can always see their own schedule (covers branch/assistant managers
  -- with can_create_schedule creating drafts for any department)
  OR schedules.created_by = auth.uid()
);

DROP POLICY IF EXISTS schedules_update ON public.schedules;
CREATE POLICY schedules_update ON public.schedules
FOR UPDATE
USING (
  has_role(auth.uid(), 'main_admin'::app_role)
  OR has_schedule_approve_perm(auth.uid())
  OR has_schedule_publish_perm(auth.uid())
  OR (
    has_role(auth.uid(), 'department_manager'::app_role)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
    AND status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status, 'pending_approval'::schedule_status])
  )
  -- NEW: creator can edit their own draft/rejected schedules
  OR (
    schedules.created_by = auth.uid()
    AND status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
  )
)
WITH CHECK (
  has_role(auth.uid(), 'main_admin'::app_role)
  OR has_schedule_approve_perm(auth.uid())
  OR has_schedule_publish_perm(auth.uid())
  OR (
    has_role(auth.uid(), 'department_manager'::app_role)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
  )
  OR schedules.created_by = auth.uid()
);

DROP POLICY IF EXISTS schedules_delete ON public.schedules;
CREATE POLICY schedules_delete ON public.schedules
FOR DELETE
USING (
  has_role(auth.uid(), 'main_admin'::app_role)
  OR has_schedule_publish_perm(auth.uid())
  OR has_schedule_approve_perm(auth.uid())
  OR (
    has_role(auth.uid(), 'department_manager'::app_role)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
    AND status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
  )
  -- NEW: creator can delete their own draft/rejected schedules
  OR (
    schedules.created_by = auth.uid()
    AND status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
  )
);

-- schedule_shifts: allow creator to SELECT and WRITE for their own draft/rejected schedules
DROP POLICY IF EXISTS shifts_select ON public.schedule_shifts;
CREATE POLICY shifts_select ON public.schedule_shifts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.id = schedule_shifts.schedule_id
      AND (
        (has_role(auth.uid(), 'department_manager'::app_role)
          AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id))
        OR (
          (has_role(auth.uid(), 'main_admin'::app_role)
            OR has_schedule_approve_perm(auth.uid())
            OR has_schedule_publish_perm(auth.uid()))
          AND s.status <> ALL (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
        )
        OR EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid() AND p.department_id = s.department_id
            AND s.status = 'approved'::schedule_status
        )
        OR s.created_by = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS shifts_write ON public.schedule_shifts;
CREATE POLICY shifts_write ON public.schedule_shifts
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.id = schedule_shifts.schedule_id
      AND (
        has_role(auth.uid(), 'main_admin'::app_role)
        OR has_schedule_publish_perm(auth.uid())
        OR (has_schedule_approve_perm(auth.uid()) AND s.status = 'pending_approval'::schedule_status)
        OR (
          has_role(auth.uid(), 'department_manager'::app_role)
          AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
          AND s.status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
        )
        OR (
          s.created_by = auth.uid()
          AND s.status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.id = schedule_shifts.schedule_id
      AND (
        has_role(auth.uid(), 'main_admin'::app_role)
        OR has_schedule_publish_perm(auth.uid())
        OR (has_schedule_approve_perm(auth.uid()) AND s.status = 'pending_approval'::schedule_status)
        OR (
          has_role(auth.uid(), 'department_manager'::app_role)
          AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
          AND s.status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
        )
        OR (
          s.created_by = auth.uid()
          AND s.status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
        )
      )
  )
);
