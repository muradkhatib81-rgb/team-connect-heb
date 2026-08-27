-- بصمة: خمس فئات ثابتة فقط (بدون تكرار أدوار + مسميات)
-- مدير فرع / نائب مدير / مدير شؤون أفراد / مسؤول مخزن / رئيس قسم
-- Does NOT touch user_roles / user_task_permissions.

CREATE TABLE IF NOT EXISTS public.attendance_punch_category_settings (
  category text PRIMARY KEY,
  can_punch boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT attendance_punch_category_settings_allowed CHECK (
    category IN (
      'branch_manager',
      'assistant_manager',
      'hr_manager',
      'warehouse_manager',
      'department_manager'
    )
  )
);

INSERT INTO public.attendance_punch_category_settings (category, can_punch)
VALUES
  ('branch_manager', false),
  ('assistant_manager', false),
  ('hr_manager', false),
  ('warehouse_manager', false),
  ('department_manager', false)
ON CONFLICT (category) DO NOTHING;

-- Migrate prior role toggles if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'attendance_role_punch_settings'
  ) THEN
    UPDATE public.attendance_punch_category_settings c
    SET can_punch = COALESCE(r.can_punch, false),
        updated_at = COALESCE(r.updated_at, now()),
        updated_by = r.updated_by
    FROM public.attendance_role_punch_settings r
    WHERE c.category = r.role::text;
  END IF;
END $$;

REVOKE ALL ON public.attendance_punch_category_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_punch_category_settings TO authenticated;
GRANT ALL ON public.attendance_punch_category_settings TO service_role;

ALTER TABLE public.attendance_punch_category_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_punch_category_owner ON public.attendance_punch_category_settings;
CREATE POLICY attendance_punch_category_owner ON public.attendance_punch_category_settings
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS attendance_punch_category_select ON public.attendance_punch_category_settings;
CREATE POLICY attendance_punch_category_select ON public.attendance_punch_category_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.attendance_normalize_title(_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(regexp_replace(COALESCE(_title, ''), '\s+', ' ', 'g')));
$$;

-- Match profile job_title (ar / he / en aliases) to a punch category
CREATE OR REPLACE FUNCTION public.attendance_title_matches_category(_title text, _category text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := public.attendance_normalize_title(_title);
BEGIN
  IF v = '' OR _category IS NULL THEN
    RETURN false;
  END IF;

  IF _category = 'branch_manager' THEN
    RETURN v IN (
        'מנהל סניף', 'مدير فرع', 'مدير الفرع', 'branch manager', 'branch_manager'
      )
      OR v LIKE '%מנהל סניף%'
      OR v LIKE '%مدير فرع%'
      OR v LIKE '%branch manager%';
  END IF;

  IF _category = 'assistant_manager' THEN
    RETURN v IN (
        'סגן מנהל', 'نائب مدير', 'نائب المدير', 'deputy manager', 'assistant manager', 'assistant_manager'
      )
      OR v LIKE '%סגן מנהל%'
      OR v LIKE '%نائب مدير%'
      OR v LIKE '%نائب المدير%'
      OR v LIKE '%deputy manager%'
      OR v LIKE '%assistant manager%';
  END IF;

  IF _category = 'hr_manager' THEN
    RETURN v IN (
        'מנהל כוח אדם', 'כוח אדם', 'مدير شؤون افراد', 'مدير شؤون أفراد',
        'شؤون افراد', 'شؤون أفراد', 'hr manager', 'human resources'
      )
      OR v LIKE '%כוח אדם%'
      OR v LIKE '%شؤون افراد%'
      OR v LIKE '%شؤون أفراد%'
      OR v LIKE '%hr manager%'
      OR v LIKE '%human resources%';
  END IF;

  IF _category = 'warehouse_manager' THEN
    RETURN v IN (
        'אחראי מחסן', 'مسؤول مخزن', 'مسئول مخزن', 'warehouse manager', 'storekeeper'
      )
      OR v LIKE '%אחראי מחסן%'
      OR v LIKE '%מחסן%'
      OR v LIKE '%مسؤول مخزن%'
      OR v LIKE '%مسئول مخزن%'
      OR v LIKE '%warehouse%';
  END IF;

  IF _category = 'department_manager' THEN
    RETURN v IN (
        'אחראי מחלקה', 'رئيس قسم', 'مسؤول القسم', 'مسئول القسم',
        'department head', 'department manager', 'dept head'
      )
      OR v LIKE '%אחראי מחלקה%'
      OR v LIKE '%رئيس قسم%'
      OR v LIKE '%مسؤول القسم%'
      OR v LIKE '%مسئول القسم%'
      OR v LIKE '%department head%'
      OR v LIKE '%department manager%';
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_category_allows_punch(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_cat text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.job_title INTO v_title
  FROM public.profiles p
  WHERE p.id = _user_id;

  FOR v_cat IN
    SELECT s.category
    FROM public.attendance_punch_category_settings s
    WHERE s.can_punch IS TRUE
  LOOP
    -- System role match (for the three app roles)
    IF v_cat IN ('branch_manager', 'assistant_manager', 'department_manager') THEN
      IF EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id AND ur.role::text = v_cat
      ) THEN
        RETURN true;
      END IF;
    END IF;

    -- Job title alias match (ar / he / en) — covers HR + warehouse + role titles
    IF public.attendance_title_matches_category(v_title, v_cat) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_category_allows_punch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_category_allows_punch(uuid) TO authenticated, service_role;

-- Prefer category settings; keep legacy job_titles.can_punch_attendance as fallback for other titles
CREATE OR REPLACE FUNCTION public.attendance_user_allows_punch(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.attendance_category_allows_punch(_user_id)
    OR public.attendance_job_title_allows_punch(_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_user_allows_punch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_user_allows_punch(uuid) TO authenticated, service_role;
