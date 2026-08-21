-- PWA install icon: public read, Platform Owners only write.
-- Name/short_name stay language-driven in the app (i18n); only the icon is stored here.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pwa_icon_url text;

INSERT INTO storage.buckets (id, name, public)
SELECT 'platform-branding', 'platform-branding', true
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets b WHERE b.id = 'platform-branding'
);

DROP POLICY IF EXISTS platform_branding_storage_select ON storage.objects;
CREATE POLICY platform_branding_storage_select
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'platform-branding');

DROP POLICY IF EXISTS platform_branding_storage_insert ON storage.objects;
CREATE POLICY platform_branding_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'platform-branding'
    AND (
      public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
    )
  );

DROP POLICY IF EXISTS platform_branding_storage_update ON storage.objects;
CREATE POLICY platform_branding_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'platform-branding'
    AND (
      public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
    )
  )
  WITH CHECK (
    bucket_id = 'platform-branding'
    AND (
      public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
    )
  );

DROP POLICY IF EXISTS platform_branding_storage_delete ON storage.objects;
CREATE POLICY platform_branding_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'platform-branding'
    AND (
      public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
    )
  );
