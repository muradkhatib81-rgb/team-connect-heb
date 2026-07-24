-- Realtime DELETE filters on branch_id require the old row payload.
ALTER TABLE public.management_on_shift REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
