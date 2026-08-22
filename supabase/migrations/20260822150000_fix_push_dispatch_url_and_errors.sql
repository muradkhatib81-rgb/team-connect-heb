-- Fix push dispatch: require https:// scheme and never block inserts when push hook fails.

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
    -- Push is best-effort — never fail the originating insert (message, notification, etc.).
    NULL;
  END;
END;
$$;

-- Normalize any existing config saved without scheme.
UPDATE public.internal_push_config
SET
  app_public_url = CASE
    WHEN app_public_url IS NULL OR length(trim(app_public_url)) = 0 THEN app_public_url
    WHEN trim(app_public_url) ~* '^https?://' THEN rtrim(trim(app_public_url), '/')
    ELSE 'https://' || rtrim(trim(app_public_url), '/')
  END,
  updated_at = now()
WHERE id = 1;
