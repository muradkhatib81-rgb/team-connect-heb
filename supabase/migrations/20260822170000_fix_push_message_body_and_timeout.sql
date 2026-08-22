-- Fix empty message body in push trigger + increase pg_net timeout.

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
      body := body,
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
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

    IF v_title IS NULL OR length(trim(v_title)) = 0 THEN
      RETURN NEW;
    END IF;

    PERFORM public.invoke_push_dispatch_hook(jsonb_build_object(
      'userIds', jsonb_build_array(NEW.user_id::text),
      'title', v_title,
      'message', left(coalesce(nullif(trim(v_body), ''), v_title), 240),
      'messageId', NEW.message_id::text,
      'url', '/communications'
    ));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;
