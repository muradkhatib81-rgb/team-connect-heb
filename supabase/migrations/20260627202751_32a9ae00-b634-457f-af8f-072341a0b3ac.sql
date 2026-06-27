
-- Expand user_task_permissions with new granular permission columns
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_view_dashboard boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_all_employees boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_employee_details boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_add_employee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_employee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_delete_employee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_reset_employee_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_departments boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_export_employees boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_leave boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_reject_leave boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_leave_balance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_tasks boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_messages boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_send_message_employee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_send_message_department boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_send_message_all boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_export_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_permissions boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_company_settings boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_activity_log boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_users boolean NOT NULL DEFAULT false;

-- Trigger: when a user is assigned branch_manager or assistant_manager role,
-- seed their permission row with the default read-only set if not already present.
CREATE OR REPLACE FUNCTION public.seed_manager_default_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('branch_manager','assistant_manager') THEN
    INSERT INTO public.user_task_permissions (
      user_id,
      can_view_dashboard,
      can_view_all_employees,
      can_view_employee_details,
      can_view_schedule,
      can_view_tasks
    ) VALUES (
      NEW.user_id, true, true, true, true, true
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_manager_default_permissions ON public.user_roles;
CREATE TRIGGER trg_seed_manager_default_permissions
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_manager_default_permissions();
