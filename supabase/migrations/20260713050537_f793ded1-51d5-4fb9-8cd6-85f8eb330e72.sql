DROP POLICY IF EXISTS "Users insert their own break requests" ON public.break_requests;
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