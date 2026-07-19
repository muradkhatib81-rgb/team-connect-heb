-- Employees plan their own breaks (INSERT RLS: user_id = auth.uid()).
-- dispatcher_scope governs manager dispatch on behalf of others — not self-service.

CREATE OR REPLACE FUNCTION public.can_user_request_break(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title_ok boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  v_title_ok := COALESCE((
    SELECT jt.can_request_break
    FROM public.profiles p
    JOIN public.job_titles jt ON lower(btrim(jt.name)) = lower(btrim(p.job_title))
    WHERE p.id = _user_id
      AND p.job_title IS NOT NULL
      AND btrim(p.job_title) <> ''
    LIMIT 1
  ), true);

  RETURN v_title_ok AND public.can_request_break_by_policy(_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_user_request_break(uuid) TO authenticated, service_role;
