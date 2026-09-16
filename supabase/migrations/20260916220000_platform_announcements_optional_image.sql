-- Optional image on platform announcements.
-- Table UPDATE stays Platform Owner only (existing policy). Storage:
--   write = Platform Owner; read = owner or a row the viewer can already SELECT.

ALTER TABLE public.platform_announcements
  ADD COLUMN IF NOT EXISTS image_path text;

INSERT INTO storage.buckets (id, name, public)
SELECT 'platform-announcements', 'platform-announcements', false
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets b WHERE b.id = 'platform-announcements'
);

DROP POLICY IF EXISTS platform_announcements_storage_select ON storage.objects;
CREATE POLICY platform_announcements_storage_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'platform-announcements'
    AND (
      public.is_platform_owner(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.platform_announcements pa
        WHERE pa.image_path IS NOT NULL
          AND pa.image_path = name
      )
    )
  );

DROP POLICY IF EXISTS platform_announcements_storage_insert ON storage.objects;
CREATE POLICY platform_announcements_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'platform-announcements'
    AND public.is_platform_owner(auth.uid())
  );

DROP POLICY IF EXISTS platform_announcements_storage_update ON storage.objects;
CREATE POLICY platform_announcements_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'platform-announcements'
    AND public.is_platform_owner(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'platform-announcements'
    AND public.is_platform_owner(auth.uid())
  );

DROP POLICY IF EXISTS platform_announcements_storage_delete ON storage.objects;
CREATE POLICY platform_announcements_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'platform-announcements'
    AND public.is_platform_owner(auth.uid())
  );
