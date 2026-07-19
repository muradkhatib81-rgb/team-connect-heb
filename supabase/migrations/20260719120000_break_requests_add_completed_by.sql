-- break_requests_apply_policy, end_my_break, and manual_end_break reference
-- completed_by, but the column was never added to break_requests (only tasks have it).
-- This caused INSERT failures: record "new" has no field "completed_by".

ALTER TABLE public.break_requests
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.break_requests.completed_by IS
  'User who ended the break (employee self-return or manager force-return).';

-- Backfill from audit fields when present (safe if workflow columns exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'break_requests' AND column_name = 'ended_by'
  ) THEN
    UPDATE public.break_requests
    SET completed_by = COALESCE(completed_by, ended_by_manager_id)
    WHERE completed_by IS NULL
      AND ended_by = 'manager'
      AND ended_by_manager_id IS NOT NULL;

    UPDATE public.break_requests
    SET completed_by = COALESCE(completed_by, user_id)
    WHERE completed_by IS NULL
      AND ended_by = 'employee'
      AND status::text IN ('completed', 'ended_by_manager');
  END IF;
END $$;
