
CREATE TABLE public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  company_name text NOT NULL DEFAULT 'רמי לוי שער בנימין',
  logo_url text,
  address text,
  phone text,
  email text,
  primary_color text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.company_settings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.company_settings TO authenticated;
GRANT ALL ON public.company_settings TO service_role;

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_settings_select_all"
  ON public.company_settings FOR SELECT
  USING (true);

CREATE POLICY "company_settings_insert_main_admin"
  ON public.company_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

CREATE POLICY "company_settings_update_main_admin"
  ON public.company_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'main_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

CREATE TRIGGER trg_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.company_settings (company_name)
VALUES ('רמי לוי שער בנימין');
