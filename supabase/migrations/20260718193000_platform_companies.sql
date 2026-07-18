-- Platform → Company → Branch (assignment) persistence for the Foundation layer.
-- Operational store data remains in public.branches / departments / etc.

CREATE TABLE IF NOT EXISTS public.platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL
);

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid NOT NULL REFERENCES public.platforms(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  archived_at timestamptz NULL,
  logo_url text NULL,
  company_code text NULL,
  legal_name text NULL,
  tax_number text NULL,
  phone text NULL,
  email text NULL,
  address text NULL,
  currency text NOT NULL DEFAULT 'ILS',
  language text NOT NULL DEFAULT 'he',
  time_zone text NOT NULL DEFAULT 'Asia/Jerusalem',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL
);

CREATE INDEX IF NOT EXISTS companies_platform_id_idx
  ON public.companies (platform_id)
  WHERE deleted_at IS NULL;

-- Platform Branch assignment: Company ↔ operational public.branches row.
-- Named distinctly so it never collides with public.branches.
CREATE TABLE IF NOT EXISTS public.company_branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  source_branch_id uuid NOT NULL REFERENCES public.branches(id),
  name text NOT NULL,
  code text NULL,
  address text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS company_branch_assignments_source_uidx
  ON public.company_branch_assignments (source_branch_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS company_branch_assignments_company_id_idx
  ON public.company_branch_assignments (company_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_branch_assignments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platforms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_branch_assignments TO authenticated;
GRANT ALL ON public.platforms TO service_role;
GRANT ALL ON public.companies TO service_role;
GRANT ALL ON public.company_branch_assignments TO service_role;

DROP POLICY IF EXISTS platforms_owner_all ON public.platforms;
CREATE POLICY platforms_owner_all ON public.platforms
  FOR ALL TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  )
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  );

DROP POLICY IF EXISTS companies_owner_all ON public.companies;
CREATE POLICY companies_owner_all ON public.companies
  FOR ALL TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  )
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  );

DROP POLICY IF EXISTS company_branch_assignments_owner_all ON public.company_branch_assignments;
CREATE POLICY company_branch_assignments_owner_all ON public.company_branch_assignments
  FOR ALL TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  )
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  );

-- Stable default Platform id used by the app (DEFAULT_PLATFORM_ID).
INSERT INTO public.platforms (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Default Platform')
ON CONFLICT (id) DO NOTHING;
