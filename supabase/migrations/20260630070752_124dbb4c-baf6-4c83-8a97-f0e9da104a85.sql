
-- 1) Insert "הנהלה" department
INSERT INTO public.departments (name, code, is_active)
  VALUES ('הנהלה', 'management', true)
  ON CONFLICT (code) DO NOTHING;

-- 2) Managed job titles table
CREATE TABLE IF NOT EXISTS public.job_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  excluded_from_headcount boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_titles_name_lower_unique
  ON public.job_titles (lower(btrim(name)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_titles TO authenticated;
GRANT ALL ON public.job_titles TO service_role;

ALTER TABLE public.job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view job titles" ON public.job_titles;
CREATE POLICY "Authenticated can view job titles"
  ON public.job_titles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Main admin can insert job titles" ON public.job_titles;
CREATE POLICY "Main admin can insert job titles"
  ON public.job_titles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

DROP POLICY IF EXISTS "Main admin can update job titles" ON public.job_titles;
CREATE POLICY "Main admin can update job titles"
  ON public.job_titles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'main_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

DROP POLICY IF EXISTS "Main admin can delete job titles" ON public.job_titles;
CREATE POLICY "Main admin can delete job titles"
  ON public.job_titles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'main_admin'));

DROP TRIGGER IF EXISTS update_job_titles_updated_at ON public.job_titles;
CREATE TRIGGER update_job_titles_updated_at
  BEFORE UPDATE ON public.job_titles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Denormalized flag on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS excluded_from_headcount boolean NOT NULL DEFAULT false;

-- 4) Sync trigger on profiles when job_title changes
CREATE OR REPLACE FUNCTION public.sync_profile_excluded_from_headcount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_excluded boolean;
BEGIN
  IF NEW.job_title IS NULL OR btrim(NEW.job_title) = '' THEN
    NEW.excluded_from_headcount := false;
  ELSE
    SELECT excluded_from_headcount INTO v_excluded
      FROM public.job_titles
      WHERE lower(btrim(name)) = lower(btrim(NEW.job_title))
      LIMIT 1;
    NEW.excluded_from_headcount := COALESCE(v_excluded, false);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_sync_excluded_from_headcount ON public.profiles;
CREATE TRIGGER profiles_sync_excluded_from_headcount
  BEFORE INSERT OR UPDATE OF job_title ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_excluded_from_headcount();

-- 5) When a job_title row changes, re-sync matching profiles
CREATE OR REPLACE FUNCTION public.sync_profiles_after_job_title_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.profiles
       SET excluded_from_headcount = false
     WHERE lower(btrim(job_title)) = lower(btrim(OLD.name));
    RETURN OLD;
  END IF;
  UPDATE public.profiles
     SET excluded_from_headcount = NEW.excluded_from_headcount
   WHERE lower(btrim(job_title)) = lower(btrim(NEW.name));
  IF TG_OP = 'UPDATE' AND lower(btrim(NEW.name)) <> lower(btrim(OLD.name)) THEN
    UPDATE public.profiles
       SET excluded_from_headcount = false
     WHERE lower(btrim(job_title)) = lower(btrim(OLD.name))
       AND lower(btrim(job_title)) <> lower(btrim(NEW.name));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS job_titles_sync_profiles ON public.job_titles;
CREATE TRIGGER job_titles_sync_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.job_titles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profiles_after_job_title_change();

-- 6) Backfill existing profiles (in case any job_title matches an inserted title later)
UPDATE public.profiles p
   SET excluded_from_headcount = COALESCE(jt.excluded_from_headcount, false)
  FROM public.job_titles jt
 WHERE lower(btrim(p.job_title)) = lower(btrim(jt.name));

-- 7) Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.job_titles;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.job_titles REPLICA IDENTITY FULL;

-- 8) Expose flag through department_coworkers view if it exists
DO $$
DECLARE v_def text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='department_coworkers') THEN
    -- recreate view to include excluded_from_headcount
    EXECUTE 'CREATE OR REPLACE VIEW public.department_coworkers AS
      SELECT p.id, p.full_name, p.department_id, p.is_active, p.on_leave, p.avatar_url, p.job_title, p.excluded_from_headcount
      FROM public.profiles p
      WHERE p.department_id IS NOT NULL
        AND p.department_id = public.get_my_department_id()';
  END IF;
END $$;
