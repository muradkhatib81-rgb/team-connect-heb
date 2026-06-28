
-- 1. Track when an employee was deactivated (for 30-day archive cooldown)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- Backfill from prior status logs
UPDATE public.profiles p
   SET deactivated_at = COALESCE(
         (SELECT MAX(created_at) FROM public.profile_status_log
           WHERE profile_id = p.id AND action = 'deactivated'),
         p.updated_at,
         now()
       )
 WHERE is_active = false AND deactivated_at IS NULL;

-- 2. Allow 'archived' as a logged action
ALTER TABLE public.profile_status_log DROP CONSTRAINT IF EXISTS profile_status_log_action_check;
ALTER TABLE public.profile_status_log
  ADD CONSTRAINT profile_status_log_action_check
  CHECK (action = ANY (ARRAY['activated','deactivated','archived']));

-- 3. Updated activator: manage deactivated_at on transitions
CREATE OR REPLACE FUNCTION public.set_employee_active(_user_id uuid, _active boolean, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _current boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'אין הרשאה'; END IF;

  SELECT is_active INTO _current FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא'; END IF;

  IF _current IS DISTINCT FROM _active THEN
    UPDATE public.profiles
       SET is_active = _active,
           deactivated_at = CASE WHEN _active THEN NULL ELSE COALESCE(deactivated_at, now()) END
     WHERE id = _user_id;
    INSERT INTO public.profile_status_log(profile_id, actor_id, action, note)
    VALUES (_user_id, auth.uid(), CASE WHEN _active THEN 'activated' ELSE 'deactivated' END, _note);
  END IF;
END;
$$;

-- 4. Archive table — keeps a hidden, audit-only snapshot of deleted employees
CREATE TABLE IF NOT EXISTS public.employee_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id uuid NOT NULL,
  id_number text,
  full_name text NOT NULL,
  job_title text,
  phone text,
  department_id uuid,
  department_name text,
  avatar_url text,
  archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  reason text,
  snapshot jsonb
);

CREATE INDEX IF NOT EXISTS idx_employee_archive_id_number ON public.employee_archive(id_number);
CREATE INDEX IF NOT EXISTS idx_employee_archive_archived_at ON public.employee_archive(archived_at DESC);

GRANT SELECT, INSERT ON public.employee_archive TO authenticated;
GRANT ALL ON public.employee_archive TO service_role;

ALTER TABLE public.employee_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read archive" ON public.employee_archive;
CREATE POLICY "Admins read archive" ON public.employee_archive
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins insert archive" ON public.employee_archive;
CREATE POLICY "Admins insert archive" ON public.employee_archive
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

-- 5. Archive RPC — enforces 30-day cooldown, snapshots, removes profile + roles.
-- (Auth user deletion is performed by the server function with the service-role key.)
CREATE OR REPLACE FUNCTION public.archive_employee(_user_id uuid, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record;
  _deact timestamptz;
  _arch_id uuid;
  _days numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'לא ניתן לארכב את החשבון של עצמך'; END IF;

  SELECT p2.id, p2.full_name, p2.id_number, p2.job_title, p2.phone, p2.department_id,
         p2.avatar_url, p2.is_active, p2.deactivated_at, d.name AS dept_name
    INTO p
    FROM public.profiles p2
    LEFT JOIN public.departments d ON d.id = p2.department_id
   WHERE p2.id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא'; END IF;
  IF p.is_active THEN RAISE EXCEPTION 'יש לסמן את העובד כלא פעיל לפני המחיקה הסופית'; END IF;

  _deact := COALESCE(p.deactivated_at, now());
  _days := EXTRACT(EPOCH FROM (now() - _deact)) / 86400.0;
  IF _days < 30 THEN
    RAISE EXCEPTION 'ניתן לבצע מחיקה סופית רק לאחר 30 ימים מההשבתה (נותרו % ימים)', CEIL(30 - _days);
  END IF;

  INSERT INTO public.employee_archive(
    original_id, id_number, full_name, job_title, phone,
    department_id, department_name, avatar_url,
    archived_by, deactivated_at, reason, snapshot
  )
  VALUES (
    p.id, p.id_number, p.full_name, p.job_title, p.phone,
    p.department_id, p.dept_name, p.avatar_url,
    auth.uid(), _deact, _reason,
    jsonb_build_object(
      'id_number', p.id_number,
      'full_name', p.full_name,
      'job_title', p.job_title,
      'phone', p.phone,
      'department_id', p.department_id,
      'department_name', p.dept_name,
      'avatar_url', p.avatar_url,
      'deactivated_at', _deact
    )
  )
  RETURNING id INTO _arch_id;

  -- Unlink any department-manager assignment
  UPDATE public.departments SET manager_id = NULL WHERE manager_id = _user_id;

  -- Remove roles + profile (archive row preserves audit data; FK cascades clean up children)
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  RETURN _arch_id;
END;
$$;

-- 6. Admin-only lookup for "previously archived" warning when re-adding an ID number
CREATE OR REPLACE FUNCTION public.find_archived_by_id_number(_id_number text)
RETURNS TABLE (
  id uuid,
  original_id uuid,
  full_name text,
  job_title text,
  department_name text,
  archived_at timestamptz,
  deactivated_at timestamptz,
  snapshot jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.original_id, a.full_name, a.job_title, a.department_name,
         a.archived_at, a.deactivated_at, a.snapshot
    FROM public.employee_archive a
   WHERE a.id_number = _id_number
     AND public.is_admin(auth.uid())
   ORDER BY a.archived_at DESC
   LIMIT 1;
$$;
