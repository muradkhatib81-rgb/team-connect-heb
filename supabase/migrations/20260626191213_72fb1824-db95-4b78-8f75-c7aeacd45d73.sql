
CREATE OR REPLACE FUNCTION public.get_my_department_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department_id FROM public.profiles WHERE id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_department_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_department_id() TO authenticated;

CREATE POLICY "Users can view coworkers in their department"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  department_id IS NOT NULL
  AND department_id = public.get_my_department_id()
);
