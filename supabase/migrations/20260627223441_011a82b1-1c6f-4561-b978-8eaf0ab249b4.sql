-- 1. task_activity_log INSERT: require can_view_task
ALTER POLICY task_activity_insert ON public.task_activity_log
  WITH CHECK (
    actor_id = auth.uid()
    AND public.can_view_task(task_id, auth.uid())
  );

-- 2. task_comments INSERT: require can_view_task
ALTER POLICY task_comments_insert ON public.task_comments
  WITH CHECK (
    author_id = auth.uid()
    AND public.can_view_task(task_id, auth.uid())
  );

-- 3. task_images SELECT: delegate to can_view_task (canonical visibility)
ALTER POLICY "Task images view" ON public.task_images
  USING (public.can_view_task(task_id, auth.uid()));

-- 4. communications storage bucket: explicit UPDATE policy mirroring DELETE
DROP POLICY IF EXISTS "communications: update own or comm-mgr" ON storage.objects;
CREATE POLICY "communications: update own or comm-mgr" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'communications'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.has_manage_communications_perm(auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'communications'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.has_manage_communications_perm(auth.uid())
    )
  );