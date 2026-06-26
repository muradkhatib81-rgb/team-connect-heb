CREATE OR REPLACE FUNCTION public.has_task_close_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_approve_tasks)));
$function$;

REVOKE EXECUTE ON FUNCTION public.has_task_close_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_task_close_perm(uuid) TO authenticated, service_role;