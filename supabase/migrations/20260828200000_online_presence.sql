-- Online presence: viewer grants (separate from user_task_permissions / roles).
-- Tracks who may view live connected-user counts; presence payloads use Supabase Realtime Presence.

CREATE TABLE IF NOT EXISTS public.online_presence_viewer_grants (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_scope text NOT NULL CHECK (viewer_scope IN ('branch', 'company', 'platform')),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT online_presence_branch_scope CHECK (
    viewer_scope <> 'branch' OR branch_id IS NOT NULL
  ),
  CONSTRAINT online_presence_company_scope CHECK (
    viewer_scope <> 'company' OR company_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_online_presence_grants_branch
  ON public.online_presence_viewer_grants (branch_id)
  WHERE enabled AND viewer_scope = 'branch';

CREATE INDEX IF NOT EXISTS idx_online_presence_grants_company
  ON public.online_presence_viewer_grants (company_id)
  WHERE enabled AND viewer_scope = 'company';

COMMENT ON TABLE public.online_presence_viewer_grants IS
  'Platform-controlled grants for viewing live online-user presence. Independent of user_task_permissions.';

ALTER TABLE public.online_presence_viewer_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS online_presence_grants_select ON public.online_presence_viewer_grants;
CREATE POLICY online_presence_grants_select ON public.online_presence_viewer_grants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
  );

DROP POLICY IF EXISTS online_presence_grants_write ON public.online_presence_viewer_grants;
CREATE POLICY online_presence_grants_write ON public.online_presence_viewer_grants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'system_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'system_admin'::public.app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_presence_viewer_grants TO authenticated;
GRANT ALL ON public.online_presence_viewer_grants TO service_role;

-- Resolve viewer access for the signed-in user (platform owners implicit platform scope).
CREATE OR REPLACE FUNCTION public.resolve_online_presence_viewer_access(_user_id uuid DEFAULT auth.uid())
RETURNS TABLE (
  can_view boolean,
  viewer_scope text,
  branch_id uuid,
  company_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF public.has_role(_user_id, 'system_admin'::public.app_role)
     OR public.has_role(_user_id, 'main_admin'::public.app_role) THEN
    RETURN QUERY SELECT true, 'platform'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    g.enabled,
    g.viewer_scope,
    g.branch_id,
    g.company_id
  FROM public.online_presence_viewer_grants g
  WHERE g.user_id = _user_id
    AND g.enabled = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::uuid, NULL::uuid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_online_presence_viewer_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_online_presence_viewer_access(uuid) TO authenticated, service_role;
