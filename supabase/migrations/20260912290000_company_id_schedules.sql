-- Batch 14: nullable company_id on schedules + child tables (dual-read; RLS unchanged).
-- schedules has branch_id → sync_row_company_id_from_branch().
-- Children link via schedule_id → sync_row_company_id_from_schedule() + cascade from parent.

CREATE OR REPLACE FUNCTION public.sync_row_company_id_from_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.schedule_id IS NULL THEN
    NEW.company_id := NULL;
  ELSE
    SELECT s.company_id INTO v_company_id
    FROM public.schedules s
    WHERE s.id = NEW.schedule_id;
    IF v_company_id IS NULL THEN
      SELECT public.company_id_of_branch(s.branch_id) INTO v_company_id
      FROM public.schedules s
      WHERE s.id = NEW.schedule_id;
    END IF;
    NEW.company_id := v_company_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cascade_schedule_company_id_to_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;
  UPDATE public.schedule_shifts
    SET company_id = NEW.company_id
    WHERE schedule_id = NEW.id
      AND company_id IS DISTINCT FROM NEW.company_id;
  UPDATE public.schedule_audit_log
    SET company_id = NEW.company_id
    WHERE schedule_id = NEW.id
      AND company_id IS DISTINCT FROM NEW.company_id;
  UPDATE public.schedule_notifications
    SET company_id = NEW.company_id
    WHERE schedule_id = NEW.id
      AND company_id IS DISTINCT FROM NEW.company_id;
  RETURN NEW;
END;
$$;

-- schedules (has branch_id)
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.schedules AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedules_company_id_idx ON public.schedules (company_id);
DROP TRIGGER IF EXISTS trg_schedules_sync_company ON public.schedules;
CREATE TRIGGER trg_schedules_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();
DROP TRIGGER IF EXISTS trg_schedules_cascade_company ON public.schedules;
CREATE TRIGGER trg_schedules_cascade_company
  AFTER INSERT OR UPDATE OF company_id, branch_id ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.cascade_schedule_company_id_to_children();

-- schedule_shifts
ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.schedule_shifts AS t
SET company_id = s.company_id
FROM public.schedules s
WHERE s.id = t.schedule_id
  AND t.company_id IS NULL
  AND s.company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_shifts_company_id_idx ON public.schedule_shifts (company_id);
DROP TRIGGER IF EXISTS trg_schedule_shifts_sync_company ON public.schedule_shifts;
CREATE TRIGGER trg_schedule_shifts_sync_company
  BEFORE INSERT OR UPDATE OF schedule_id ON public.schedule_shifts
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_schedule();

-- schedule_audit_log
ALTER TABLE public.schedule_audit_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.schedule_audit_log AS t
SET company_id = s.company_id
FROM public.schedules s
WHERE s.id = t.schedule_id
  AND t.company_id IS NULL
  AND s.company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_audit_log_company_id_idx ON public.schedule_audit_log (company_id);
DROP TRIGGER IF EXISTS trg_schedule_audit_log_sync_company ON public.schedule_audit_log;
CREATE TRIGGER trg_schedule_audit_log_sync_company
  BEFORE INSERT OR UPDATE OF schedule_id ON public.schedule_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_schedule();

-- schedule_notifications
ALTER TABLE public.schedule_notifications
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.schedule_notifications AS t
SET company_id = s.company_id
FROM public.schedules s
WHERE s.id = t.schedule_id
  AND t.company_id IS NULL
  AND s.company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_notifications_company_id_idx ON public.schedule_notifications (company_id);
DROP TRIGGER IF EXISTS trg_schedule_notifications_sync_company ON public.schedule_notifications;
CREATE TRIGGER trg_schedule_notifications_sync_company
  BEFORE INSERT OR UPDATE OF schedule_id ON public.schedule_notifications
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_schedule();