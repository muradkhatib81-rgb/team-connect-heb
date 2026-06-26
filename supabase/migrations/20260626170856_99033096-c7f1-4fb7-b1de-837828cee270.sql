
-- task_images SELECT mirrors Task visibility
DROP POLICY IF EXISTS "Task images view" ON public.task_images;
CREATE POLICY "Task images view" ON public.task_images
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_images.task_id
      AND (
        public.has_task_edit_perm(auth.uid())
        OR public.is_admin(auth.uid())
        OR t.created_by = auth.uid()
        OR t.department_id IN (SELECT d.id FROM public.departments d WHERE d.manager_id = auth.uid())
        OR t.department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid())
      )
  )
);

-- task_recurrence_images SELECT mirrors Recurrence visibility
DROP POLICY IF EXISTS rec_images_view ON public.task_recurrence_images;
CREATE POLICY rec_images_view ON public.task_recurrence_images
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.task_recurrences r
    WHERE r.id = task_recurrence_images.recurrence_id
      AND (
        public.has_task_management_perm(auth.uid())
        OR public.is_admin(auth.uid())
        OR r.department_id IN (SELECT d.id FROM public.departments d WHERE d.manager_id = auth.uid())
        OR r.department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid())
      )
  )
);

-- storage.objects SELECT for task-images bucket: only owner-folder or users with task management perm
DROP POLICY IF EXISTS "task-images: read auth" ON storage.objects;
CREATE POLICY "task-images: read auth" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'task-images'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR public.has_task_management_perm(auth.uid())
    OR public.is_admin(auth.uid())
  )
);
