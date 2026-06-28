-- Add updated_by to schedules
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

-- Create a secure way to fetch basic profile info for schedule actors
CREATE OR REPLACE FUNCTION public.get_profiles_basic_info(user_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text,
  job_title text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS 1446
  SELECT p.id, p.full_name, p.job_title
  FROM public.profiles p
  WHERE p.id = ANY(user_ids);
1446;

REVOKE EXECUTE ON FUNCTION public.get_profiles_basic_info(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_basic_info(uuid[]) TO authenticated;
