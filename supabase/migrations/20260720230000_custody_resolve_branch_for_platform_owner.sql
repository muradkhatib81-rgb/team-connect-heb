-- Platform owners select company/branch in the UI; RPCs must accept explicit branch_id
-- when x-active-branch header is unavailable (common on hosted PostgREST).

CREATE OR REPLACE FUNCTION public.custody_resolve_branch(_user_id uuid, _branch_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF _branch_id IS NOT NULL AND public.is_platform_owner(_user_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = _branch_id) THEN
      RAISE EXCEPTION 'לא נמצא סניף';
    END IF;
    RETURN _branch_id;
  END IF;

  v_effective := public.custody_effective_branch(_user_id);

  IF _branch_id IS NOT NULL THEN
    IF v_effective IS NULL OR _branch_id <> v_effective THEN
      RAISE EXCEPTION 'אין הרשאה לסניף זה';
    END IF;
    RETURN _branch_id;
  END IF;

  IF v_effective IS NULL THEN
    RAISE EXCEPTION 'לא נמצא סניף';
  END IF;

  RETURN v_effective;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custody_resolve_branch(uuid, uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.upsert_custody_item_type(text, uuid, integer, boolean, integer);

CREATE OR REPLACE FUNCTION public.upsert_custody_item_type(
  _name text,
  _id uuid DEFAULT NULL,
  _sort_order integer DEFAULT 0,
  _is_active boolean DEFAULT true,
  _employee_reminder_minutes integer DEFAULT NULL,
  _branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid;
  v_out uuid;
  v_existing public.custody_item_types%ROWTYPE;
  v_deactivating boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  v_branch := public.custody_resolve_branch(v_actor, _branch_id);
  IF NULLIF(btrim(_name), '') IS NULL THEN RAISE EXCEPTION 'יש להזין שם'; END IF;

  IF _id IS NULL THEN
    IF NOT public.has_custody_create_perm(v_actor) THEN
      RAISE EXCEPTION 'אין הרשאה ליצור ציוד';
    END IF;
    INSERT INTO public.custody_item_types (
      branch_id, name, sort_order, is_active, employee_reminder_minutes
    ) VALUES (
      v_branch, btrim(_name), COALESCE(_sort_order, 0), COALESCE(_is_active, true), _employee_reminder_minutes
    )
    RETURNING id INTO v_out;
  ELSE
    SELECT * INTO v_existing FROM public.custody_item_types
    WHERE id = _id AND branch_id = v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'פריט ציוד לא נמצא'; END IF;

    v_deactivating := v_existing.is_active = true AND COALESCE(_is_active, true) = false;
    IF v_deactivating THEN
      IF NOT public.has_custody_delete_perm(v_actor) THEN
        RAISE EXCEPTION 'אין הרשאה למחוק/להשבית ציוד';
      END IF;
    ELSE
      IF NOT public.has_custody_edit_perm(v_actor) THEN
        RAISE EXCEPTION 'אין הרשאה לערוך ציוד';
      END IF;
    END IF;

    UPDATE public.custody_item_types
       SET name = btrim(_name),
           sort_order = COALESCE(_sort_order, sort_order),
           is_active = COALESCE(_is_active, is_active),
           employee_reminder_minutes = _employee_reminder_minutes,
           updated_at = now()
     WHERE id = _id AND branch_id = v_branch
     RETURNING id INTO v_out;
  END IF;

  RETURN v_out;
END;
$$;

DROP FUNCTION IF EXISTS public.upsert_custody_branch_settings(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.upsert_custody_branch_settings(
  _default_employee_reminder_minutes integer DEFAULT NULL,
  _manager_midnight_warning_minutes integer DEFAULT NULL,
  _daily_log_reset_hours integer DEFAULT NULL,
  _branch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_custody_configure_perm(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לעדכן הגדרות';
  END IF;

  v_branch := public.custody_resolve_branch(v_actor, _branch_id);

  INSERT INTO public.custody_branch_settings (branch_id)
  VALUES (v_branch)
  ON CONFLICT (branch_id) DO NOTHING;

  UPDATE public.custody_branch_settings
     SET default_employee_reminder_minutes = COALESCE(_default_employee_reminder_minutes, default_employee_reminder_minutes),
         manager_midnight_warning_minutes = COALESCE(_manager_midnight_warning_minutes, manager_midnight_warning_minutes),
         daily_log_reset_hours = COALESCE(_daily_log_reset_hours, daily_log_reset_hours),
         updated_at = now()
   WHERE branch_id = v_branch;
END;
$$;

DROP FUNCTION IF EXISTS public.checkout_custody_item(uuid);

CREATE OR REPLACE FUNCTION public.checkout_custody_item(
  _item_type_id uuid,
  _branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item public.custody_item_types%ROWTYPE;
  v_branch uuid;
  v_dept uuid;
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO v_item FROM public.custody_item_types
  WHERE id = _item_type_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'פריט ציוד לא נמצא'; END IF;

  v_branch := public.custody_resolve_branch(v_actor, COALESCE(_branch_id, v_item.branch_id));
  IF v_item.branch_id <> v_branch THEN
    RAISE EXCEPTION 'אין הרשאה לסניף זה';
  END IF;

  IF NOT public.is_custody_board_visible(v_actor) THEN
    RAISE EXCEPTION 'לוח הציוד זמין רק במהלך משמרת';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.custody_checkouts c
    WHERE c.item_type_id = _item_type_id AND c.status = 'active'
  ) THEN
    RAISE EXCEPTION 'הציוד כבר בשימוש';
  END IF;

  SELECT department_id INTO v_dept FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.custody_checkouts (
    branch_id, item_type_id, user_id, department_id,
    checked_out_by, status
  ) VALUES (
    v_branch, _item_type_id, v_actor, v_dept,
    v_actor, 'active'
  )
  RETURNING id INTO v_id;

  PERFORM public.write_custody_audit(
    v_branch, v_id, v_actor, v_actor, 'checkout',
    jsonb_build_object('item_type_id', _item_type_id, 'item_name', v_item.name)
  );

  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.return_custody_item(uuid);

CREATE OR REPLACE FUNCTION public.return_custody_item(
  _checkout_id uuid,
  _branch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  r public.custody_checkouts%ROWTYPE;
  v_item public.custody_item_types%ROWTYPE;
  v_branch uuid;
  v_is_manager boolean;
  v_return_type text;
  v_actor_name text;
  v_dur integer;
  v_spans boolean;
  v_day date;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.custody_checkouts WHERE id = _checkout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'רשומה לא נמצאה'; END IF;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'הציוד כבר הוחזר'; END IF;

  v_branch := public.custody_resolve_branch(v_actor, COALESCE(_branch_id, r.branch_id));
  IF r.branch_id <> v_branch THEN
    RAISE EXCEPTION 'אין הרשאה לסניף זה';
  END IF;

  v_is_manager := public.has_custody_return_perm(v_actor);

  IF r.user_id <> v_actor AND NOT v_is_manager THEN
    RAISE EXCEPTION 'אין הרשאה להחזיר ציוד זה';
  END IF;

  v_return_type := CASE WHEN r.user_id = v_actor THEN 'self' ELSE 'manager' END;

  v_dur := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (now() - r.checked_out_at)) / 60.0)::integer);
  v_spans := (r.checked_out_at AT TIME ZONE 'Asia/Jerusalem')::date
          <> (now() AT TIME ZONE 'Asia/Jerusalem')::date;

  UPDATE public.custody_checkouts
     SET status = 'returned',
         returned_at = now(),
         returned_by = v_actor,
         return_type = v_return_type,
         duration_minutes = v_dur,
         spans_midnight = v_spans,
         updated_at = now()
   WHERE id = _checkout_id;

  SELECT * INTO v_item FROM public.custody_item_types WHERE id = r.item_type_id;

  SELECT COALESCE(full_name, '—') INTO v_actor_name FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.custody_session_archive (
    branch_id, checkout_id, item_type_id, item_name,
    user_id, user_name, department_id, department_name,
    checked_out_at, returned_at, returned_by, return_type,
    return_actor_name, duration_minutes, spans_midnight
  )
  SELECT
    r.branch_id, r.id, r.item_type_id, v_item.name,
    r.user_id, COALESCE(p.full_name, '—'), r.department_id, d.name,
    r.checked_out_at, now(), v_actor, v_return_type,
    CASE WHEN v_return_type = 'manager' THEN v_actor_name ELSE NULL END,
    v_dur, v_spans
  FROM public.profiles p
  LEFT JOIN public.departments d ON d.id = r.department_id
  WHERE p.id = r.user_id;

  v_day := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  INSERT INTO public.custody_daily_entries (
    branch_id, stat_date, user_id, item_type_id, checkout_count, total_minutes
  ) VALUES (
    r.branch_id, v_day, r.user_id, r.item_type_id, 1, v_dur
  )
  ON CONFLICT (branch_id, stat_date, user_id, item_type_id)
  DO UPDATE SET
    checkout_count = custody_daily_entries.checkout_count + 1,
    total_minutes = custody_daily_entries.total_minutes + EXCLUDED.total_minutes,
    updated_at = now();

  PERFORM public.write_custody_audit(
    r.branch_id, _checkout_id, v_actor, r.user_id, 'return',
    jsonb_build_object(
      'return_type', v_return_type,
      'duration_minutes', v_dur,
      'manager_name', CASE WHEN v_return_type = 'manager' THEN v_actor_name ELSE NULL END
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_custody_item_type(text, uuid, integer, boolean, integer, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_custody_branch_settings(integer, integer, integer, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.checkout_custody_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.return_custody_item(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.upsert_custody_item_type(text, uuid, integer, boolean, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_custody_branch_settings(integer, integer, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.checkout_custody_item(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_custody_item(uuid, uuid) TO authenticated, service_role;
