-- Guarantee app-owned loud Web Push: drop DB push triggers that race the app
-- and can deliver a second/quiet notification. Keep invoke_push_dispatch_hook
-- as a no-op for any leftover callers.

DROP TRIGGER IF EXISTS push_on_schedule_notification ON public.schedule_notifications;
DROP TRIGGER IF EXISTS push_on_message_recipient ON public.message_recipients;

CREATE OR REPLACE FUNCTION public.invoke_push_dispatch_hook(body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;
