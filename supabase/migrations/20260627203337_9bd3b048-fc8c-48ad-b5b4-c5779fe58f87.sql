DROP POLICY IF EXISTS company_settings_select_all ON public.company_settings;
CREATE POLICY company_settings_select_authenticated ON public.company_settings FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.company_settings FROM anon;