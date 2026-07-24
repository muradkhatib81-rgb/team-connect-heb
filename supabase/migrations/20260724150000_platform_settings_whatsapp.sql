-- Platform-wide public settings (singleton). WhatsApp contact is readable by
-- anonymous visitors on the sign-in screen; only Platform Owners may update.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  whatsapp_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (id, whatsapp_number)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.platform_settings TO anon;
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_select_all ON public.platform_settings;
CREATE POLICY platform_settings_select_all
  ON public.platform_settings
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS platform_settings_update_owners ON public.platform_settings;
CREATE POLICY platform_settings_update_owners
  ON public.platform_settings
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
  );

DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
