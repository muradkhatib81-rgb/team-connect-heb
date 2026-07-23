-- Published time snapshots (may be missing if 20260721260000 was not applied yet).
ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS published_start_time time,
  ADD COLUMN IF NOT EXISTS published_end_time time;

-- Baseline snapshot when a department head submits for approval (manager-edit detection).
ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS submitted_shift text,
  ADD COLUMN IF NOT EXISTS submitted_start_time time,
  ADD COLUMN IF NOT EXISTS submitted_end_time time,
  ADD COLUMN IF NOT EXISTS submitted_note text;

-- Backfill submitted baseline from existing published snapshot on schedules that were
-- submitted but not yet published (pending / approved-awaiting-publish).
UPDATE public.schedule_shifts ss
SET
  submitted_shift = COALESCE(ss.submitted_shift, ss.published_shift, ss.shift),
  submitted_start_time = COALESCE(ss.submitted_start_time, ss.published_start_time, ss.start_time),
  submitted_end_time = COALESCE(ss.submitted_end_time, ss.published_end_time, ss.end_time),
  submitted_note = COALESCE(ss.submitted_note, ss.published_note, ss.note)
FROM public.schedules s
WHERE ss.schedule_id = s.id
  AND s.submitted_at IS NOT NULL
  AND (s.published_at IS NULL OR s.status <> 'approved');

-- Clear published snapshot on unpublished submitted rows so publish-only baseline stays clean.
UPDATE public.schedule_shifts ss
SET
  published_shift = NULL,
  published_start_time = NULL,
  published_end_time = NULL,
  published_note = NULL
FROM public.schedules s
WHERE ss.schedule_id = s.id
  AND s.submitted_at IS NOT NULL
  AND (s.published_at IS NULL OR s.status <> 'approved');

NOTIFY pgrst, 'reload schema';
