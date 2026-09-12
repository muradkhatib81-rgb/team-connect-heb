-- Batch 12: nullable company_id on tasks/comms/UTP (dual-read; RLS unchanged).
-- Reuses sync_row_company_id_from_branch().

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.tasks AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_company_id_idx ON public.tasks (company_id);
DROP TRIGGER IF EXISTS trg_tasks_sync_company ON public.tasks;
CREATE TRIGGER trg_tasks_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.task_recurrences
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.task_recurrences AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_recurrences_company_id_idx ON public.task_recurrences (company_id);
DROP TRIGGER IF EXISTS trg_task_recurrences_sync_company ON public.task_recurrences;
CREATE TRIGGER trg_task_recurrences_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.task_recurrences
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.task_activity_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.task_activity_log AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_activity_log_company_id_idx ON public.task_activity_log (company_id);
DROP TRIGGER IF EXISTS trg_task_activity_log_sync_company ON public.task_activity_log;
CREATE TRIGGER trg_task_activity_log_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.task_activity_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.messages AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_company_id_idx ON public.messages (company_id);
DROP TRIGGER IF EXISTS trg_messages_sync_company ON public.messages;
CREATE TRIGGER trg_messages_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.announcements AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS announcements_company_id_idx ON public.announcements (company_id);
DROP TRIGGER IF EXISTS trg_announcements_sync_company ON public.announcements;
CREATE TRIGGER trg_announcements_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.communications_audit_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.communications_audit_log AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS communications_audit_log_company_id_idx ON public.communications_audit_log (company_id);
DROP TRIGGER IF EXISTS trg_communications_audit_log_sync_company ON public.communications_audit_log;
CREATE TRIGGER trg_communications_audit_log_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.communications_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.user_task_permissions AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_task_permissions_company_id_idx ON public.user_task_permissions (company_id);
DROP TRIGGER IF EXISTS trg_user_task_permissions_sync_company ON public.user_task_permissions;
CREATE TRIGGER trg_user_task_permissions_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.user_task_permissions
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

