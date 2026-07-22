-- Optional short per-day note on a schedule cell (e.g. temporary assignment hint).
ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS note text;

-- Snapshot note at publish for post-publish change markers.
ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS published_note text;

COMMENT ON COLUMN public.schedule_shifts.note IS
  'Optional per-day note, max 10 chars enforced in app (e.g. works in another department).';

NOTIFY pgrst, 'reload schema';
