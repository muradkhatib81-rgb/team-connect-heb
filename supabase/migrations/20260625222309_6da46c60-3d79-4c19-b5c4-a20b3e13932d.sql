
CREATE POLICY "task-images: read own or task-mgr"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-images' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_task_management_perm(auth.uid())
      OR public.is_admin(auth.uid())
    )
  );

CREATE POLICY "task-images: insert own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-images' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "task-images: delete own or task-mgr"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-images' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_task_management_perm(auth.uid())
    )
  );

CREATE POLICY "task-images: update own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'task-images' AND auth.uid()::text = (storage.foldername(name))[1]
  );
