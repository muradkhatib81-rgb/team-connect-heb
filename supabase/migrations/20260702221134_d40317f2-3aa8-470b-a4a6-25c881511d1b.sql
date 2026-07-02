
ALTER TABLE public.morning_board_items
  DROP CONSTRAINT IF EXISTS morning_board_items_item_type_check;

ALTER TABLE public.morning_board_items
  ADD CONSTRAINT morning_board_items_item_type_check
  CHECK (item_type IN ('image','video','audio','announcement','highlight'));

ALTER TABLE public.morning_board_items
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

ALTER TABLE public.morning_board_items
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal','important','urgent','critical'));

ALTER TABLE public.morning_board_items
  ADD COLUMN IF NOT EXISTS style jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS morning_board_items_branch_pinned_idx
  ON public.morning_board_items (branch_id, is_pinned DESC, display_order);
