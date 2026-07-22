-- Allow message/announcement senders to permanently delete their own items.

CREATE OR REPLACE FUNCTION public.purge_message_global(_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_sender uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT title, sender_id INTO v_title, v_sender
  FROM public.messages
  WHERE id = _message_id;

  IF v_title IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    v_sender = auth.uid()
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_delete_communications_perm(auth.uid())
  ) THEN
    RAISE EXCEPTION 'אין הרשאה למחיקה';
  END IF;

  DELETE FROM public.schedule_notifications
  WHERE message LIKE ('הודעה עודכנה: ' || v_title || '%');

  DELETE FROM public.messages WHERE id = _message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_announcement_global(_ann_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_sender uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT title, sender_id INTO v_title, v_sender
  FROM public.announcements
  WHERE id = _ann_id;

  IF v_title IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    v_sender = auth.uid()
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_delete_communications_perm(auth.uid())
  ) THEN
    RAISE EXCEPTION 'אין הרשאה למחיקה';
  END IF;

  DELETE FROM public.schedule_notifications
  WHERE message LIKE ('הכרזה עודכנה: ' || v_title || '%');

  DELETE FROM public.announcements WHERE id = _ann_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_message_global(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_announcement_global(uuid) TO authenticated;
