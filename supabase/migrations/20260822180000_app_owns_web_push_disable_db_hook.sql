-- App server owns Web Push (sound, vibrate, unique tags).
-- DB pg_net hooks caused either silent/missed alerts or duplicates when both
-- the trigger and the app dispatched the same event.
-- Keep schedule_notifications / message_recipients / management_on_shift
-- insert triggers for in-app rows; only disable the HTTP push dispatch.

CREATE OR REPLACE FUNCTION public.invoke_push_dispatch_hook(body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Intentionally no-op. Web Push is sent from the app (notifyUsersWithPush /
  -- dispatchMessagePush / announceManagementOnShiftChange).
  RETURN;
END;
$$;
