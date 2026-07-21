-- Optional date range for employee leave; schedule auto-fills "off" (חופש) for days in range.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leave_start_date date,
  ADD COLUMN IF NOT EXISTS leave_end_date date;

COMMENT ON COLUMN public.profiles.leave_start_date IS
  'First day of leave when on_leave is true; schedule marks these days as off (חופש).';
COMMENT ON COLUMN public.profiles.leave_end_date IS
  'Last day of leave (inclusive) when on_leave is true.';
