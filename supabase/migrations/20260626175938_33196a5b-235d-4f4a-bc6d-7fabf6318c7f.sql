
ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS published_shift text;

-- Backfill: for approved schedules, snapshot equals current shift (no changes yet).
UPDATE public.schedule_shifts ss
SET published_shift = ss.shift
FROM public.schedules s
WHERE ss.schedule_id = s.id
  AND s.status = 'approved'
  AND ss.published_shift IS NULL;
