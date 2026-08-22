-- Universal Web Push dispatch for all schedule_notifications, messages, and management-on-shift events.
-- Requires one-time setup in internal_push_config (see .env.example).

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.internal_push_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_public_url text,
  dispatch_secret text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.internal_push_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON public.internal_push_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_push_config TO service_role;
ALTER TABLE public.internal_push_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.invoke_push_dispatch_hook(body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT app_public_url, dispatch_secret INTO v_url, v_secret
  FROM public.internal_push_config WHERE id = 1;
  IF v_url IS NULL OR v_secret IS NULL OR length(trim(v_url)) = 0 OR length(trim(v_secret)) = 0 THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/hooks/dispatch-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body := body
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_push_dispatch_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_push_dispatch_hook(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_push_on_schedule_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start text;
BEGIN
  IF NEW.schedule_id IS NOT NULL THEN
    SELECT week_start INTO v_week_start FROM public.schedules WHERE id = NEW.schedule_id;
  END IF;

  PERFORM public.invoke_push_dispatch_hook(jsonb_build_object(
    'userIds', jsonb_build_array(NEW.user_id::text),
    'message', NEW.message,
    'scheduleId', NEW.schedule_id,
    'weekStart', v_week_start
  ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_on_schedule_notification ON public.schedule_notifications;
CREATE TRIGGER push_on_schedule_notification
  AFTER INSERT ON public.schedule_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_push_on_schedule_notification();

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_on_message_recipient ON public.message_recipients;
CREATE TRIGGER push_on_message_recipient
  AFTER INSERT ON public.message_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_push_on_message_recipient();

CREATE OR REPLACE FUNCTION public.trg_notify_branch_management_on_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_branch_on_management_shift ON public.management_on_shift;
CREATE TRIGGER notify_branch_on_management_shift
  AFTER INSERT ON public.management_on_shift
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_branch_management_on_shift();
