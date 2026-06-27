
REVOKE EXECUTE ON FUNCTION public.get_task_assignees(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_task_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_task_status_change() FROM PUBLIC, anon, authenticated;
