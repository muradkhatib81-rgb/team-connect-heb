-- 1. task_assignees SELECT: restrict to users who can view the task
DROP POLICY IF EXISTS task_assignees_select ON public.task_assignees;
CREATE POLICY task_assignees_select ON public.task_assignees
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_view_task(task_id, auth.uid())
  );

-- 2. task_departments SELECT: restrict to users who can view the task
DROP POLICY IF EXISTS task_departments_select ON public.task_departments;
CREATE POLICY task_departments_select ON public.task_departments
  FOR SELECT TO authenticated
  USING (public.can_view_task(task_id, auth.uid()));

-- 3. Storage: expand read for task-images to legitimate task participants.
DROP POLICY IF EXISTS "task-images: read auth" ON storage.objects;
CREATE POLICY "task-images: read auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-images'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.has_task_management_perm(auth.uid())
      OR public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.task_images ti
        WHERE ti.storage_path = storage.objects.name
          AND public.can_view_task(ti.task_id, auth.uid())
      )
    )
  );

-- 4. Revoke EXECUTE on SECURITY DEFINER functions from anon where not needed.
-- (has_main_admin remains anon-callable: required by the public /auth screen.)
REVOKE EXECUTE ON FUNCTION public.get_my_department_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_message_edited(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_announcement_edited(uuid, text) FROM anon, PUBLIC;