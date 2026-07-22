-- Keep auth.users login email (id_number@employees.ramilevy.local) in sync with profiles.id_number.

CREATE OR REPLACE FUNCTION public.employee_auth_email(_id_number text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(_id_number) || '@employees.ramilevy.local');
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_auth_email(
  _user_id uuid,
  _id_number text,
  _first_name text DEFAULT NULL,
  _last_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id text;
  v_email text;
  v_old_email text;
  v_conflict uuid;
  v_meta jsonb;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'חשבון ההתחברות של העובד לא נמצא';
  END IF;

  v_id := NULLIF(trim(_id_number), '');
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  IF v_id !~ '^\d{5,15}$' THEN
    RAISE EXCEPTION 'מספר זהות לא תקין';
  END IF;

  v_email := public.employee_auth_email(v_id);

  SELECT lower(u.email) INTO v_old_email
  FROM auth.users u
  WHERE u.id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'חשבון ההתחברות של העובד לא נמצא';
  END IF;

  IF v_old_email <> v_email THEN
    SELECT u.id INTO v_conflict
    FROM auth.users u
    WHERE lower(u.email) = v_email
      AND u.id <> _user_id
    LIMIT 1;

    IF v_conflict IS NOT NULL THEN
      RAISE EXCEPTION 'כבר קיים חשבון התחברות עם מספר זהות זה';
    END IF;
  END IF;

  SELECT u.raw_user_meta_data INTO v_meta
  FROM auth.users u
  WHERE u.id = _user_id;

  v_meta := COALESCE(v_meta, '{}'::jsonb) || jsonb_build_object('id_number', v_id);
  IF _first_name IS NOT NULL AND trim(_first_name) <> '' THEN
    v_meta := v_meta || jsonb_build_object('first_name', trim(_first_name));
  END IF;
  IF _last_name IS NOT NULL AND trim(_last_name) <> '' THEN
    v_meta := v_meta || jsonb_build_object('last_name', trim(_last_name));
  END IF;

  UPDATE auth.users
  SET
    email = v_email,
    raw_user_meta_data = v_meta,
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
  WHERE id = _user_id;

  UPDATE auth.identities i
  SET
    identity_data = COALESCE(i.identity_data, '{}'::jsonb)
      || jsonb_build_object('email', v_email, 'email_verified', true, 'sub', _user_id::text),
    updated_at = now()
  WHERE i.user_id = _user_id
    AND i.provider = 'email';
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_profiles_sync_auth_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.id_number IS DISTINCT FROM OLD.id_number AND NEW.id_number IS NOT NULL THEN
    PERFORM public.sync_profile_auth_email(
      NEW.id,
      NEW.id_number,
      NEW.first_name,
      NEW.last_name
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_sync_auth_email ON public.profiles;
CREATE TRIGGER trg_profiles_sync_auth_email
  AFTER UPDATE OF id_number ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_profiles_sync_auth_email();

-- Repair existing rows where profile id_number and auth email diverged.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.id, p.id_number, p.first_name, p.last_name
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id_number IS NOT NULL
      AND trim(p.id_number) <> ''
      AND lower(u.email) IS DISTINCT FROM public.employee_auth_email(p.id_number)
  LOOP
    BEGIN
      PERFORM public.sync_profile_auth_email(
        r.id,
        r.id_number,
        r.first_name,
        r.last_name
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'sync_profile_auth_email skipped for %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_profile_auth_email(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_auth_email(uuid, text, text, text) TO service_role;
