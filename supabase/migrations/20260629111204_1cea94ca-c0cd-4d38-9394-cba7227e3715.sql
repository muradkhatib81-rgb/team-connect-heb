
-- 1. Create shift_definitions table
CREATE TABLE public.shift_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  start_time time NULL,
  end_time time NULL,
  color text NOT NULL DEFAULT '#94a3b8',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shift_definitions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.shift_definitions TO authenticated;
GRANT ALL ON public.shift_definitions TO service_role;

ALTER TABLE public.shift_definitions ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated may read active shifts (needed everywhere shifts render)
CREATE POLICY shift_def_select ON public.shift_definitions
  FOR SELECT TO authenticated USING (true);

-- Only main_admin or users with schedule manage/publish permission may write
CREATE POLICY shift_def_insert ON public.shift_definitions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'main_admin')
    OR public.has_schedule_manage_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
  );

CREATE POLICY shift_def_update ON public.shift_definitions
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'main_admin')
    OR public.has_schedule_manage_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'main_admin')
    OR public.has_schedule_manage_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
  );

CREATE POLICY shift_def_delete ON public.shift_definitions
  FOR DELETE TO authenticated
  USING (
    is_system = false
    AND (
      public.has_role(auth.uid(),'main_admin')
      OR public.has_schedule_manage_perm(auth.uid())
      OR public.has_schedule_publish_perm(auth.uid())
    )
  );

CREATE TRIGGER trg_shift_definitions_updated_at
  BEFORE UPDATE ON public.shift_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Seed system shifts that preserve existing data
INSERT INTO public.shift_definitions (code, name, start_time, end_time, color, sort_order, is_system, is_active)
VALUES
  ('morning', 'בוקר', '06:00', '14:00', '#f59e0b', 1, true, true),
  ('evening', 'ערב',  '14:00', '22:00', '#0ea5e9', 2, true, true),
  ('off',     'חופש',  NULL,    NULL,    '#10b981', 99, true, true);

-- 3. Convert schedule_shifts.shift from enum to text (preserves all existing data)
ALTER TABLE public.schedule_shifts
  ALTER COLUMN shift TYPE text USING shift::text;

-- published_shift is already text in current schema (verified) — no change required.

-- 4. Add a check constraint via trigger that validates shift code exists in shift_definitions
CREATE OR REPLACE FUNCTION public.validate_schedule_shift_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.shift IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shift_definitions WHERE code = NEW.shift
  ) THEN
    RAISE EXCEPTION 'קוד משמרת לא תקין: %', NEW.shift;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_schedule_shift
  BEFORE INSERT OR UPDATE ON public.schedule_shifts
  FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_shift_code();
