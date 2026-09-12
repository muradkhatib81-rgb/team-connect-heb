-- Batch 1b: revoke dead anon SELECT on company_settings.
-- Login no longer relies on anon table reads (empty under RLS anyway).
-- Does not change authenticated SELECT (still USING true) or roles.

REVOKE SELECT ON public.company_settings FROM anon;
