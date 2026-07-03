ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS start_time time NULL,
  ADD COLUMN IF NOT EXISTS end_time   time NULL;

CREATE INDEX IF NOT EXISTS schedule_shifts_branch_day_idx
  ON public.schedule_shifts (branch_id, day_date);