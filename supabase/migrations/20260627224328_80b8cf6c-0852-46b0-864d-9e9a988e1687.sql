
-- 1) New granular permission: delete communications
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_delete_communications boolean NOT NULL DEFAULT false;

-- 2) Helper: explicit delete permission for communications
CREATE OR REPLACE FUNCTION public.has_delete_communications_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_delete_communications OR can_manage_communications)
      );
$$;
REVOKE EXECUTE ON FUNCTION public.has_delete_communications_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_delete_communications_perm(uuid) TO authenticated, service_role;

-- 3) Send-permission helpers: pure permission-based (no role-only fallback besides main_admin)
CREATE OR REPLACE FUNCTION public.has_send_messages_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id
                   AND (can_send_messages OR can_manage_communications));
$$;

-- has_send_announcements_perm already pure perm-based; leave unchanged.

-- 4) Tighten DELETE policies on messages/announcements: require explicit delete perm.
DROP POLICY IF EXISTS messages_delete ON public.messages;
CREATE POLICY messages_delete ON public.messages
  FOR DELETE TO authenticated
  USING (public.has_delete_communications_perm(auth.uid()));

DROP POLICY IF EXISTS ann_delete ON public.announcements;
CREATE POLICY ann_delete ON public.announcements
  FOR DELETE TO authenticated
  USING (public.has_delete_communications_perm(auth.uid()));

-- 5) Tighten dept-manager send scope at DB layer.
-- For message INSERT: a dept-manager (without manage_communications) is only allowed
-- to send to their own department via message_targets/recipients. We enforce this on
-- message_targets and message_recipients inserts.
DROP POLICY IF EXISTS message_targets_insert ON public.message_targets;
CREATE POLICY message_targets_insert ON public.message_targets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_message_sender(message_id, auth.uid())
    AND (
      public.has_role(auth.uid(),'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = auth.uid() AND can_manage_communications)
      OR (
        -- dept-manager constrained scope: only their department or specific users in their dept
        target_type = 'department'::comm_target_type
        AND target_id = public.get_my_department_id()
      )
      OR (
        target_type = 'user'::comm_target_type
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = target_id AND p.department_id = public.get_my_department_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS announcement_targets_insert ON public.announcement_targets;
CREATE POLICY announcement_targets_insert ON public.announcement_targets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_announcement_sender(announcement_id, auth.uid())
    AND (
      public.has_role(auth.uid(),'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = auth.uid() AND can_manage_communications)
      OR (
        target_type = 'department'::comm_target_type
        AND target_id = public.get_my_department_id()
      )
      OR (
        target_type = 'user'::comm_target_type
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = target_id AND p.department_id = public.get_my_department_id()
        )
      )
    )
  );
