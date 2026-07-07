-- Atomic branch creation with optional department structure copy.
CREATE OR REPLACE FUNCTION public.create_branch_with_departments(
  _name text,
  _code text,
  _address text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _is_active boolean DEFAULT true,
  _copy_from_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _new_id uuid;
  _suffix text;
  _src_count int;
  _copied int := 0;
  src record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF EXISTS (SELECT 1 FROM public.branches WHERE code = _code) THEN
    RAISE EXCEPTION 'קוד סניף כבר קיים במערכת';
  END IF;

  IF _copy_from_branch_id IS NOT NULL THEN
    SELECT COUNT(*) INTO _src_count
    FROM public.departments
    WHERE branch_id = _copy_from_branch_id;
    IF _src_count = 0 THEN
      RAISE EXCEPTION 'לסניף המקור אין מחלקות להעתקה';
    END IF;
  END IF;

  INSERT INTO public.branches (name, code, address, phone, is_active)
  VALUES (_name, _code, _address, _phone, COALESCE(_is_active, true))
  RETURNING id INTO _new_id;

  IF _copy_from_branch_id IS NOT NULL THEN
    _suffix := substr(md5(random()::text), 1, 4);
    FOR src IN
      SELECT name, code, is_active
      FROM public.departments
      WHERE branch_id = _copy_from_branch_id
      ORDER BY created_at, name
    LOOP
      INSERT INTO public.departments (name, code, is_active, branch_id, manager_id)
      VALUES (src.name, src.code || '_' || _suffix, src.is_active, _new_id, NULL);
      _copied := _copied + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', _new_id,
    'departments_copied', _copied
  );
END;
$function$;
