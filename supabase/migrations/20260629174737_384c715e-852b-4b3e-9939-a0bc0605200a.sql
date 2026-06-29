DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'user_roles','user_task_permissions','shift_definitions',
    'schedule_audit_log','task_assignees','task_departments',
    'task_comments','task_activity_log','task_recurrence_images',
    'message_attachments','message_targets','announcement_attachments',
    'profile_status_log','company_settings','communications_audit_log',
    'employee_archive','employee_of_month'
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;