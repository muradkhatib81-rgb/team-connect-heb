
CREATE TABLE IF NOT EXISTS public.morning_board_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('image','video','announcement')),
  title text,
  description text,
  storage_path text,
  mime_type text,
  file_size bigint,
  starts_at timestamptz,
  expires_at timestamptz,
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS morning_board_items_branch_order_idx
  ON public.morning_board_items (branch_id, display_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.morning_board_items TO authenticated;
GRANT ALL ON public.morning_board_items TO service_role;

ALTER TABLE public.morning_board_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_morning_board_for_branch(_uid uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_uid, 'main_admin')
    OR public.has_role(_uid, 'system_admin')
    OR (
      public.has_manage_morning_board_perm(_uid)
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _uid AND p.branch_id = _branch_id
      )
    );
$$;

CREATE POLICY "mbi_select_authenticated"
  ON public.morning_board_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "mbi_insert_managers"
  ON public.morning_board_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_morning_board_for_branch(auth.uid(), branch_id));

CREATE POLICY "mbi_update_managers"
  ON public.morning_board_items
  FOR UPDATE TO authenticated
  USING (public.can_manage_morning_board_for_branch(auth.uid(), branch_id))
  WITH CHECK (public.can_manage_morning_board_for_branch(auth.uid(), branch_id));

CREATE POLICY "mbi_delete_managers"
  ON public.morning_board_items
  FOR DELETE TO authenticated
  USING (public.can_manage_morning_board_for_branch(auth.uid(), branch_id));

DROP TRIGGER IF EXISTS morning_board_items_touch_updated_at ON public.morning_board_items;
CREATE TRIGGER morning_board_items_touch_updated_at
BEFORE UPDATE ON public.morning_board_items
FOR EACH ROW EXECUTE FUNCTION public.branch_banners_touch_updated_at();

INSERT INTO public.morning_board_items (branch_id, item_type, title, description, storage_path, starts_at, expires_at, display_order, created_at, updated_at)
SELECT bb.branch_id, 'image', bb.title, bb.description, bb.image_path, bb.starts_at, bb.expires_at, 0, bb.created_at, bb.updated_at
FROM public.branch_banners bb
WHERE bb.image_path IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.morning_board_items m
    WHERE m.branch_id = bb.branch_id AND m.storage_path = bb.image_path
  );

DROP POLICY IF EXISTS "mb_storage_select_authenticated" ON storage.objects;
CREATE POLICY "mb_storage_select_authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'morning-board');

DROP POLICY IF EXISTS "mb_storage_write_managers" ON storage.objects;
CREATE POLICY "mb_storage_write_managers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'morning-board'
    AND public.can_manage_morning_board_for_branch(
      auth.uid(),
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );

DROP POLICY IF EXISTS "mb_storage_update_managers" ON storage.objects;
CREATE POLICY "mb_storage_update_managers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'morning-board'
    AND public.can_manage_morning_board_for_branch(
      auth.uid(),
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );

DROP POLICY IF EXISTS "mb_storage_delete_managers" ON storage.objects;
CREATE POLICY "mb_storage_delete_managers"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'morning-board'
    AND public.can_manage_morning_board_for_branch(
      auth.uid(),
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );
