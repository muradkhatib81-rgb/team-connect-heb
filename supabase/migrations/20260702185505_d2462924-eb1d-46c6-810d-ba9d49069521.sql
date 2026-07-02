
-- =========================================================================
-- STAGE 2 — Platform Owner Separation (additive; no policy rewrites)
-- =========================================================================

-- ---------- A) Read RPCs: exclude Platform Owners -----------------------

-- Management on shift
CREATE OR REPLACE FUNCTION public.get_management_on_shift()
 RETURNS TABLE(id uuid, user_id uuid, started_at timestamp with time zone,
               full_name text, avatar_url text, job_title text, role app_role)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.id,
    m.user_id,
    m.started_at,
    p.full_name,
    p.avatar_url,
    p.job_title,
    (
      SELECT ur.role
      FROM public.user_roles ur
      WHERE ur.user_id = m.user_id
        AND ur.role IN ('branch_manager'::app_role, 'assistant_manager'::app_role)
      ORDER BY CASE ur.role
        WHEN 'branch_manager'::app_role THEN 1
        WHEN 'assistant_manager'::app_role THEN 2
        ELSE 9
      END
      LIMIT 1
    ) AS role
  FROM public.management_on_shift m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE (public.current_active_branch() IS NULL
         OR m.branch_id = public.current_active_branch())
    AND NOT public.is_platform_owner(m.user_id)
  ORDER BY m.started_at ASC;
$function$;

-- Department coworkers
CREATE OR REPLACE FUNCTION public.get_department_coworkers()
 RETURNS TABLE(id uuid, full_name text, department_id uuid, is_active boolean,
               on_leave boolean, avatar_url text, job_title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name, p.department_id, p.is_active, p.on_leave, p.avatar_url, p.job_title
  FROM public.profiles p
  WHERE p.department_id IS NOT NULL
    AND p.department_id = public.get_my_department_id()
    AND NOT public.is_platform_owner(p.id);
$function$;

-- ID number lookup
CREATE OR REPLACE FUNCTION public.find_profile_by_id_number(_id_number text)
 RETURNS TABLE(id uuid, full_name text, is_active boolean, department_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name, p.is_active, p.department_id
  FROM public.profiles p
  WHERE p.id_number = _id_number
    AND (public.is_admin(auth.uid()) OR public.has_view_all_employees_perm(auth.uid()))
    AND NOT public.is_platform_owner(p.id)
  LIMIT 1;
$function$;

-- Employee contact directory
CREATE OR REPLACE FUNCTION public.list_profiles_contact()
 RETURNS TABLE(id uuid, id_number text, phone text, must_change_password boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE (public.has_role(auth.uid(), 'main_admin')
         OR public.has_view_employee_details_perm(auth.uid()))
    AND NOT public.is_platform_owner(p.id);
$function$;

-- Employee of the Month
CREATE OR REPLACE FUNCTION public.get_employees_of_month(_year integer, _month integer)
 RETURNS TABLE(id uuid, year integer, month integer, employee_id uuid, reason text,
               image_url text, full_name text, avatar_url text, job_title text,
               department_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.year, e.month, e.employee_id, e.reason, e.image_url,
         p.full_name, p.avatar_url, p.job_title, d.name AS department_name,
         e.created_at
  FROM public.employee_of_month e
  LEFT JOIN public.profiles p ON p.id = e.employee_id
  LEFT JOIN public.departments d ON d.id = p.department_id
  WHERE e.year = _year
    AND e.month = _month
    AND (public.current_active_branch() IS NULL
         OR e.branch_id = public.current_active_branch())
    AND NOT public.is_platform_owner(e.employee_id)
  ORDER BY e.created_at;
$function$;


-- ---------- B) Insert-guard triggers: reject Platform Owners ------------
CREATE OR REPLACE FUNCTION public.reject_platform_owner_as_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_col text := TG_ARGV[0];
BEGIN
  EXECUTE format('SELECT ($1).%I', v_col) INTO v_uid USING NEW;
  IF v_uid IS NOT NULL AND public.is_platform_owner(v_uid) THEN
    RAISE EXCEPTION 'בעלי מערכת אינם נחשבים כעובדים ולא ניתן לשייך אותם לפעולה זו';
  END IF;
  RETURN NEW;
END;
$$;

-- management_on_shift.user_id
DROP TRIGGER IF EXISTS trg_reject_platform_owner_mos ON public.management_on_shift;
CREATE TRIGGER trg_reject_platform_owner_mos
BEFORE INSERT ON public.management_on_shift
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_owner_as_employee('user_id');

-- employee_of_month.employee_id
DROP TRIGGER IF EXISTS trg_reject_platform_owner_eom ON public.employee_of_month;
CREATE TRIGGER trg_reject_platform_owner_eom
BEFORE INSERT ON public.employee_of_month
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_owner_as_employee('employee_id');

-- schedule_shifts.employee_id
DROP TRIGGER IF EXISTS trg_reject_platform_owner_shifts ON public.schedule_shifts;
CREATE TRIGGER trg_reject_platform_owner_shifts
BEFORE INSERT ON public.schedule_shifts
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_owner_as_employee('employee_id');

-- break_requests.user_id
DROP TRIGGER IF EXISTS trg_reject_platform_owner_breaks ON public.break_requests;
CREATE TRIGGER trg_reject_platform_owner_breaks
BEFORE INSERT ON public.break_requests
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_owner_as_employee('user_id');

-- task_assignees.user_id
DROP TRIGGER IF EXISTS trg_reject_platform_owner_task_assignees ON public.task_assignees;
CREATE TRIGGER trg_reject_platform_owner_task_assignees
BEFORE INSERT ON public.task_assignees
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_owner_as_employee('user_id');
