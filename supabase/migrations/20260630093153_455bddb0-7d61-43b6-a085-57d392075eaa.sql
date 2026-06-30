
-- Add can_request_break flag to job_titles
ALTER TABLE public.job_titles
  ADD COLUMN IF NOT EXISTS can_request_break boolean NOT NULL DEFAULT true;

-- Helper: can a given user request a break, based on their job title?
CREATE OR REPLACE FUNCTION public.can_user_request_break(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT jt.can_request_break
      FROM public.profiles p
      JOIN public.job_titles jt
        ON lower(btrim(jt.name)) = lower(btrim(p.job_title))
      WHERE p.id = _user_id
        AND p.job_title IS NOT NULL
        AND btrim(p.job_title) <> ''
      LIMIT 1
    ),
    true
  );
$$;

-- Block inserts at the DB level when the user's job title is not allowed.
DROP POLICY IF EXISTS "Users insert own break requests" ON public.break_requests;
DROP POLICY IF EXISTS "Users can insert own break requests" ON public.break_requests;
DROP POLICY IF EXISTS "users_insert_own_break_requests" ON public.break_requests;

CREATE POLICY "Users insert own break requests"
ON public.break_requests
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.can_user_request_break(auth.uid())
);
