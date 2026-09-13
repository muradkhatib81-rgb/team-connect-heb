-- Optimistic-lock support: who last edited a task (schedules already have updated_by; messages use edited_by).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.tasks
SET updated_by = created_by
WHERE updated_by IS NULL AND created_by IS NOT NULL;

COMMENT ON COLUMN public.tasks.updated_by IS
  'Last content editor; used with updated_at for optimistic locking.';
