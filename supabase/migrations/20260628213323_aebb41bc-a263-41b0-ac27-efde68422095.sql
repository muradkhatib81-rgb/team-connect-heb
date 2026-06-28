
-- Audit log for profile activation/deactivation events
CREATE TABLE IF NOT EXISTS public.profile_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('activated','deactivated')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.profile_status_log TO authenticated;
GRANT ALL ON public.profile_status_log TO service_role;

ALTER TABLE public.profile_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and view-all can read status log"
  ON public.profile_status_log FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_view_all_employees_perm(auth.uid())
  );

CREATE POLICY "Admins can insert status log"
  ON public.profile_status_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_profile_status_log_profile ON public.profile_status_log(profile_id, created_at DESC);

-- Lookup existing employee by id_number (returns active flag too, so the UI can offer reactivation).
CREATE OR REPLACE FUNCTION public.find_profile_by_id_number(_id_number text)
RETURNS TABLE(id uuid, full_name text, is_active boolean, department_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.is_active, p.department_id
  FROM public.profiles p
  WHERE p.id_number = _id_number
    AND (public.is_admin(auth.uid()) OR public.has_view_all_employees_perm(auth.uid()))
  LIMIT 1;
$$;

-- Toggle active state + write audit entry in one call.
CREATE OR REPLACE FUNCTION public.set_employee_active(_user_id uuid, _active boolean, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;

  SELECT is_active INTO _current FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'עובד לא נמצא';
  END IF;

  IF _current IS DISTINCT FROM _active THEN
    UPDATE public.profiles SET is_active = _active WHERE id = _user_id;
    INSERT INTO public.profile_status_log(profile_id, actor_id, action, note)
    VALUES (_user_id, auth.uid(), CASE WHEN _active THEN 'activated' ELSE 'deactivated' END, _note);
  END IF;
END;
$$;
