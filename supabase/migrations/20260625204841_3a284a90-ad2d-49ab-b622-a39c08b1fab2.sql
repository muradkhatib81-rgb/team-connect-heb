
CREATE POLICY "Authenticated can view avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY "Admins can upload avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can update avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'avatars' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND public.is_admin(auth.uid()));
