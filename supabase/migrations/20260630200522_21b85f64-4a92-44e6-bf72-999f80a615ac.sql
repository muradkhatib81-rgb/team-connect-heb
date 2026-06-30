
-- Add manager_id to branches for Branch Manager assignment.
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Ensure a single manager can only be assigned to one branch at a time.
CREATE UNIQUE INDEX IF NOT EXISTS branches_manager_unique
  ON public.branches(manager_id) WHERE manager_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS branches_manager_idx ON public.branches(manager_id);
