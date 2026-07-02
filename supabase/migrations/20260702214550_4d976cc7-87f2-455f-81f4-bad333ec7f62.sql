
-- 1) New permission column
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_manage_morning_board boolean NOT NULL DEFAULT false;

-- 2) Permission helper mirroring has_manage_employee_of_month_perm
CREATE OR REPLACE FUNCTION public.has_manage_morning_board_perm(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(_uid, 'main_admin')
      OR public.has_role(_uid, 'system_admin')
      OR public.has_role(_uid, 'branch_manager')
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _uid AND can_manage_morning_board = true
      );
$$;

-- 3) branch_banners table (one active banner per branch; reusable for future fields)
CREATE TABLE IF NOT EXISTS public.branch_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  image_path text NOT NULL,
  title text,
  description text,
  starts_at timestamptz,
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_banners TO authenticated;
GRANT ALL ON public.branch_banners TO service_role;

ALTER TABLE public.branch_banners ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can see banners
CREATE POLICY "banners_select_authenticated"
  ON public.branch_banners FOR SELECT
  TO authenticated
  USING (true);

-- Manage: authorized users only. Branch managers restricted to their own branch,
-- platform owners (main_admin/system_admin) + users with the new perm can manage any branch.
CREATE POLICY "banners_insert_authorized"
  ON public.branch_banners FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions
      WHERE user_id = auth.uid() AND can_manage_morning_board = true
    )
    OR (
      public.has_role(auth.uid(), 'branch_manager')
      AND branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "banners_update_authorized"
  ON public.branch_banners FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions
      WHERE user_id = auth.uid() AND can_manage_morning_board = true
    )
    OR (
      public.has_role(auth.uid(), 'branch_manager')
      AND branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions
      WHERE user_id = auth.uid() AND can_manage_morning_board = true
    )
    OR (
      public.has_role(auth.uid(), 'branch_manager')
      AND branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "banners_delete_authorized"
  ON public.branch_banners FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions
      WHERE user_id = auth.uid() AND can_manage_morning_board = true
    )
    OR (
      public.has_role(auth.uid(), 'branch_manager')
      AND branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.branch_banners_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branch_banners_updated_at ON public.branch_banners;
CREATE TRIGGER trg_branch_banners_updated_at
  BEFORE UPDATE ON public.branch_banners
  FOR EACH ROW EXECUTE FUNCTION public.branch_banners_touch_updated_at();

-- 4) Storage policies on branch-banners bucket
-- Path convention: <branch_id>/<filename>. Authenticated users can read;
-- authorized users can write/replace/delete within their allowed branch(es).

CREATE POLICY "banner_objects_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'branch-banners');

CREATE POLICY "banner_objects_insert_authorized"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'branch-banners'
    AND (
      public.has_role(auth.uid(), 'main_admin')
      OR public.has_role(auth.uid(), 'system_admin')
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = auth.uid() AND can_manage_morning_board = true
      )
      OR (
        public.has_role(auth.uid(), 'branch_manager')
        AND (storage.foldername(name))[1] = (SELECT branch_id::text FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

CREATE POLICY "banner_objects_update_authorized"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'branch-banners'
    AND (
      public.has_role(auth.uid(), 'main_admin')
      OR public.has_role(auth.uid(), 'system_admin')
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = auth.uid() AND can_manage_morning_board = true
      )
      OR (
        public.has_role(auth.uid(), 'branch_manager')
        AND (storage.foldername(name))[1] = (SELECT branch_id::text FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

CREATE POLICY "banner_objects_delete_authorized"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'branch-banners'
    AND (
      public.has_role(auth.uid(), 'main_admin')
      OR public.has_role(auth.uid(), 'system_admin')
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = auth.uid() AND can_manage_morning_board = true
      )
      OR (
        public.has_role(auth.uid(), 'branch_manager')
        AND (storage.foldername(name))[1] = (SELECT branch_id::text FROM public.profiles WHERE id = auth.uid())
      )
    )
  );
