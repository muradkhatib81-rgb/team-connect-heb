
CREATE POLICY "comm_upload_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'communications' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "comm_view_accessible" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'communications' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_manage_communications_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.message_attachments ma
               JOIN public.messages m ON m.id = ma.message_id
               WHERE ma.storage_path = name
                 AND (m.sender_id = auth.uid()
                      OR EXISTS (SELECT 1 FROM public.message_recipients r
                                 WHERE r.message_id = m.id AND r.user_id = auth.uid())))
    OR EXISTS (SELECT 1 FROM public.announcement_attachments aa
               JOIN public.announcements a ON a.id = aa.announcement_id
               WHERE aa.storage_path = name
                 AND (a.sender_id = auth.uid()
                      OR EXISTS (SELECT 1 FROM public.announcement_targets t
                                 WHERE t.announcement_id = a.id
                                   AND (t.target_type = 'all'
                                        OR (t.target_type='department'
                                            AND t.target_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid()))
                                        OR (t.target_type='user' AND t.target_id = auth.uid())))))
  )
);

CREATE POLICY "comm_delete_own_or_admin" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'communications' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_manage_communications_perm(auth.uid())
  )
);
