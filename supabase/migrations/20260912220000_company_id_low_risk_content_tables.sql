-- Batch 7: nullable company_id on low-risk branch-scoped content tables.
-- Dual-read period: existing RLS stays on branch_in_my_companies; column is backfilled
-- for assigned branches and left NULL for unassigned. No RLS rewrite yet. No NOT NULL.

-- morning_board_items
ALTER TABLE public.morning_board_items
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.morning_board_items m
SET company_id = public.company_id_of_branch(m.branch_id)
WHERE m.company_id IS NULL
  AND m.branch_id IS NOT NULL
  AND public.company_id_of_branch(m.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS morning_board_items_company_id_idx
  ON public.morning_board_items (company_id);

-- branch_banners
ALTER TABLE public.branch_banners
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.branch_banners b
SET company_id = public.company_id_of_branch(b.branch_id)
WHERE b.company_id IS NULL
  AND b.branch_id IS NOT NULL
  AND public.company_id_of_branch(b.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS branch_banners_company_id_idx
  ON public.branch_banners (company_id);

-- break_policy
ALTER TABLE public.break_policy
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.break_policy p
SET company_id = public.company_id_of_branch(p.branch_id)
WHERE p.company_id IS NULL
  AND p.branch_id IS NOT NULL
  AND public.company_id_of_branch(p.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS break_policy_company_id_idx
  ON public.break_policy (company_id);

-- Keep company_id in sync on INSERT/UPDATE of branch_id (low-risk tables only).
CREATE OR REPLACE FUNCTION public.sync_row_company_id_from_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.company_id := NULL;
  ELSE
    NEW.company_id := public.company_id_of_branch(NEW.branch_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_morning_board_items_sync_company ON public.morning_board_items;
CREATE TRIGGER trg_morning_board_items_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.morning_board_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

DROP TRIGGER IF EXISTS trg_branch_banners_sync_company ON public.branch_banners;
CREATE TRIGGER trg_branch_banners_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.branch_banners
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

DROP TRIGGER IF EXISTS trg_break_policy_sync_company ON public.break_policy;
CREATE TRIGGER trg_break_policy_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.break_policy
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();