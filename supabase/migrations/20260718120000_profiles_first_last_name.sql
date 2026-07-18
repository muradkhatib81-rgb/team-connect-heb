-- Split profiles.full_name into first_name + last_name while keeping full_name in sync.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

-- Backfill from existing full_name (first token = first_name, remainder = last_name).
UPDATE public.profiles
SET
  first_name = CASE
    WHEN first_name IS NOT NULL AND first_name <> '' THEN first_name
    WHEN strpos(trim(full_name), ' ') > 0 THEN split_part(trim(full_name), ' ', 1)
    ELSE trim(COALESCE(full_name, ''))
  END,
  last_name = CASE
    WHEN last_name IS NOT NULL AND last_name <> '' THEN last_name
    WHEN strpos(trim(full_name), ' ') > 0 THEN trim(substring(trim(full_name) from strpos(trim(full_name), ' ') + 1))
    ELSE ''
  END
WHERE first_name IS NULL OR last_name IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN first_name SET DEFAULT '',
  ALTER COLUMN last_name SET DEFAULT '';

UPDATE public.profiles SET first_name = '' WHERE first_name IS NULL;
UPDATE public.profiles SET last_name = '' WHERE last_name IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN first_name SET NOT NULL,
  ALTER COLUMN last_name SET NOT NULL;

-- Keep full_name derived from first_name + last_name for legacy RPCs and ordering.
CREATE OR REPLACE FUNCTION public.sync_profile_full_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.full_name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_sync_full_name ON public.profiles;
CREATE TRIGGER profiles_sync_full_name
  BEFORE INSERT OR UPDATE OF first_name, last_name
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_full_name();

-- Re-sync full_name for all existing rows.
UPDATE public.profiles
SET first_name = first_name;

-- Archive table: preserve split names alongside full_name.
ALTER TABLE public.employee_archive
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

UPDATE public.employee_archive
SET
  first_name = CASE
    WHEN first_name IS NOT NULL AND first_name <> '' THEN first_name
    WHEN strpos(trim(full_name), ' ') > 0 THEN split_part(trim(full_name), ' ', 1)
    ELSE trim(COALESCE(full_name, ''))
  END,
  last_name = CASE
    WHEN last_name IS NOT NULL AND last_name <> '' THEN last_name
    WHEN strpos(trim(full_name), ' ') > 0 THEN trim(substring(trim(full_name) from strpos(trim(full_name), ' ') + 1))
    ELSE ''
  END
WHERE first_name IS NULL OR last_name IS NULL;

-- New-user trigger: read first_name / last_name from metadata (fallback: split full_name).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_count INT;
  assigned_role public.app_role;
  meta_role text;
  meta_dept_code text;
  meta_dept_id_text text;
  resolved_dept_id uuid;
  must_change boolean;
  meta_first text;
  meta_last text;
  meta_full text;
  resolved_first text;
  resolved_last text;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;

  meta_role := NULLIF(NEW.raw_user_meta_data->>'role', '');
  meta_dept_code := NULLIF(NEW.raw_user_meta_data->>'department', '');
  meta_dept_id_text := NULLIF(NEW.raw_user_meta_data->>'department_id', '');
  meta_first := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'first_name', '')), '');
  meta_last := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'last_name', '')), '');
  meta_full := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');

  IF meta_first IS NULL AND meta_full IS NOT NULL THEN
    IF strpos(meta_full, ' ') > 0 THEN
      resolved_first := split_part(meta_full, ' ', 1);
      resolved_last := trim(substring(meta_full from strpos(meta_full, ' ') + 1));
    ELSE
      resolved_first := meta_full;
      resolved_last := '';
    END IF;
  ELSE
    resolved_first := COALESCE(meta_first, split_part(NEW.email, '@', 1));
    resolved_last := COALESCE(meta_last, '');
  END IF;

  IF user_count = 0 THEN
    assigned_role := 'main_admin';
    must_change := false;
  ELSE
    BEGIN
      assigned_role := COALESCE(meta_role, 'employee')::public.app_role;
    EXCEPTION WHEN others THEN
      assigned_role := 'employee';
    END;
    must_change := true;
  END IF;

  IF meta_dept_id_text IS NOT NULL THEN
    BEGIN
      resolved_dept_id := meta_dept_id_text::uuid;
    EXCEPTION WHEN others THEN
      resolved_dept_id := NULL;
    END;
  END IF;

  IF resolved_dept_id IS NULL AND meta_dept_code IS NOT NULL THEN
    SELECT id INTO resolved_dept_id FROM public.departments WHERE code = meta_dept_code LIMIT 1;
  END IF;

  IF resolved_dept_id IS NULL THEN
    SELECT id INTO resolved_dept_id FROM public.departments WHERE code = 'general' LIMIT 1;
  END IF;

  INSERT INTO public.profiles (
    id, first_name, last_name, id_number, department_id, job_title, phone, must_change_password
  )
  VALUES (
    NEW.id,
    resolved_first,
    resolved_last,
    NULLIF(NEW.raw_user_meta_data->>'id_number', ''),
    resolved_dept_id,
    NULLIF(NEW.raw_user_meta_data->>'job_title', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    must_change
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  RETURN NEW;
END;
$function$;

-- Archive RPC: snapshot first_name / last_name.
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

  SELECT p2.id, p2.first_name, p2.last_name, p2.full_name, p2.id_number, p2.job_title, p2.phone, p2.department_id,
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
    original_id, id_number, first_name, last_name, full_name, job_title, phone,
    department_id, department_name, avatar_url,
    archived_by, deactivated_at, reason, snapshot
  )
  VALUES (
    p.id, p.id_number, p.first_name, p.last_name, p.full_name, p.job_title, p.phone,
    p.department_id, p.dept_name, p.avatar_url,
    auth.uid(), _deact, _reason,
    jsonb_build_object(
      'id_number', p.id_number,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', p.full_name,
      'job_title', p.job_title,
      'phone', p.phone,
      'department_id', p.department_id,
      'department_name', p.dept_name,
      'avatar_url', p.avatar_url
    )
  )
  RETURNING id INTO _arch_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  INSERT INTO public.profile_status_log(profile_id, actor_id, action, note)
  VALUES (_user_id, auth.uid(), 'archived', _reason);

  RETURN _arch_id;
END;
$$;
