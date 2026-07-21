-- Snapshot shift times at publish/approve for "modified after publish" detection.
ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS published_start_time time,
  ADD COLUMN IF NOT EXISTS published_end_time time;

UPDATE public.schedule_shifts ss
SET
  published_start_time = COALESCE(ss.published_start_time, ss.start_time),
  published_end_time = COALESCE(ss.published_end_time, ss.end_time)
FROM public.schedules s
WHERE ss.schedule_id = s.id
  AND s.status = 'approved'
  AND ss.published_shift IS NOT NULL;

NOTIFY pgrst, 'reload schema';
