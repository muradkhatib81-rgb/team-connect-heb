-- Harden all push triggers: never block messages, schedules, breaks, or management-on-shift.

CREATE OR REPLACE FUNCTION public.invoke_push_dispatch_hook(body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_target text;
BEGIN
  SELECT app_public_url, dispatch_secret INTO v_url, v_secret
  FROM public.internal_push_config WHERE id = 1;
  IF v_url IS NULL OR v_secret IS NULL OR length(trim(v_url)) = 0 OR length(trim(v_secret)) = 0 THEN
    RETURN;
  END IF;

  v_url := trim(v_url);
  IF v_url !~* '^https?://' THEN
    v_url := 'https://' || v_url;
  END IF;
  v_target := rtrim(v_url, '/') || '/api/public/hooks/dispatch-push';

  BEGIN
    PERFORM net.http_post(
      url := v_target,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', v_secret
      ),
      body := body
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_push_on_schedule_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start text;
BEGIN
  BEGIN
    IF NEW.schedule_id IS NOT NULL THEN
      SELECT week_start INTO v_week_start FROM public.schedules WHERE id = NEW.schedule_id;
    END IF;

    PERFORM public.invoke_push_dispatch_hook(jsonb_build_object(
      'userIds', jsonb_build_array(NEW.user_id::text),
      'message', NEW.message,
      'scheduleId', to_jsonb(NEW.schedule_id),
      'weekStart', to_jsonb(v_week_start)
    ));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_push_on_message_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
BEGIN
  BEGIN
    SELECT m.title, m.body INTO v_title, v_body
    FROM public.messages m
    WHERE m.id = NEW.message_id AND m.deleted_at IS NULL;

    IF v_title IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM public.invoke_push_dispatch_hook(jsonb_build_object(
      'userIds', jsonb_build_array(NEW.user_id::text),
      'title', v_title,
      'message', left(coalesce(v_body, v_title), 240),
      'messageId', NEW.message_id::text,
      'url', '/communications'
    ));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_notify_branch_management_on_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  BEGIN
    SELECT coalesce(
      nullif(trim(full_name), ''),
      nullif(trim(first_name || ' ' || last_name), ''),
      'מנהל/ת'
    )
    INTO v_name
    FROM public.profiles
    WHERE id = NEW.user_id;

    INSERT INTO public.schedule_notifications (user_id, message, branch_id)
    SELECT
      p.id,
      v_name || ' נמצא/ת במשמרת',
      NEW.branch_id
    FROM public.profiles p
    WHERE p.branch_id = NEW.branch_id
      AND p.id <> NEW.user_id
      AND p.is_active IS DISTINCT FROM false;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

UPDATE public.internal_push_config
SET
  app_public_url = CASE
    WHEN app_public_url IS NULL OR length(trim(app_public_url)) = 0 THEN app_public_url
    WHEN trim(app_public_url) ~* '^https?://' THEN rtrim(trim(app_public_url), '/')
    ELSE 'https://' || rtrim(trim(app_public_url), '/')
  END,
  updated_at = now()
WHERE id = 1;
