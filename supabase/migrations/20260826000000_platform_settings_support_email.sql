-- Persist platform support email (was in-memory only via ConfigurationManager).

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS support_email text;

COMMENT ON COLUMN public.platform_settings.support_email IS
  'Public platform support contact email; editable by Platform Owners.';
