
-- Edit tracking on messages and announcements
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS edit_count int NOT NULL DEFAULT 0;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS edit_count int NOT NULL DEFAULT 0;

-- Tighten edit RLS: only sender (or manage_communications) can edit messages
-- Already covered by existing messages_update / ann_update policies. No change needed.

-- Helper: notify all message recipients who already read the message that it was edited.
CREATE OR REPLACE FUNCTION public.notify_message_edited(_message_id uuid, _title text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.schedule_notifications (schedule_id, user_id, message)
  SELECT NULL, mr.user_id, 'הודעה עודכנה: ' || COALESCE(_title,'')
  FROM public.message_recipients mr
  WHERE mr.message_id = _message_id
    AND mr.read_at IS NOT NULL
    AND mr.user_id <> auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_announcement_edited(_ann_id uuid, _title text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.schedule_notifications (schedule_id, user_id, message)
  SELECT NULL, ar.user_id, 'הכרזה עודכנה: ' || COALESCE(_title,'')
  FROM public.announcement_reads ar
  WHERE ar.announcement_id = _ann_id
    AND ar.user_id <> auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_message_edited(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_announcement_edited(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_message_edited(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_announcement_edited(uuid, text) TO authenticated;
