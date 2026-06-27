
-- Helper functions (SECURITY DEFINER → bypass RLS, break recursion)
CREATE OR REPLACE FUNCTION public.is_message_recipient(_msg_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.message_recipients
    WHERE message_id = _msg_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_message_sender(_msg_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages WHERE id = _msg_id AND sender_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_announcement_sender(_ann_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements WHERE id = _ann_id AND sender_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_view_announcement(_ann_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcement_targets t
    WHERE t.announcement_id = _ann_id
      AND (
        t.target_type = 'all'::comm_target_type
        OR (t.target_type = 'user'::comm_target_type AND t.target_id = _user_id)
        OR (t.target_type = 'department'::comm_target_type
            AND t.target_id = (SELECT department_id FROM public.profiles WHERE id = _user_id))
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_message_recipient(uuid, uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.is_message_sender(uuid, uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.is_announcement_sender(uuid, uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_announcement(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_message_recipient(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_message_sender(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_announcement_sender(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_announcement(uuid, uuid) TO authenticated;

-- ============ messages ============
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
USING (
  deleted_at IS NULL AND (
    sender_id = auth.uid()
    OR public.has_role(auth.uid(),'main_admin')
    OR public.has_manage_communications_perm(auth.uid())
    OR public.is_message_recipient(id, auth.uid())
  )
);

-- ============ message_recipients ============
DROP POLICY IF EXISTS mrecipients_select ON public.message_recipients;
CREATE POLICY mrecipients_select ON public.message_recipients FOR SELECT
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
  OR public.is_message_sender(message_id, auth.uid())
);

DROP POLICY IF EXISTS mrecipients_insert ON public.message_recipients;
CREATE POLICY mrecipients_insert ON public.message_recipients FOR INSERT
WITH CHECK (public.is_message_sender(message_id, auth.uid()));

DROP POLICY IF EXISTS mrecipients_delete ON public.message_recipients;
CREATE POLICY mrecipients_delete ON public.message_recipients FOR DELETE
USING (
  public.is_message_sender(message_id, auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
);

-- ============ message_targets ============
DROP POLICY IF EXISTS mtargets_select ON public.message_targets;
CREATE POLICY mtargets_select ON public.message_targets FOR SELECT
USING (
  public.is_message_sender(message_id, auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
  OR public.is_message_recipient(message_id, auth.uid())
);

DROP POLICY IF EXISTS mtargets_insert ON public.message_targets;
CREATE POLICY mtargets_insert ON public.message_targets FOR INSERT
WITH CHECK (public.is_message_sender(message_id, auth.uid()));

DROP POLICY IF EXISTS mtargets_delete ON public.message_targets;
CREATE POLICY mtargets_delete ON public.message_targets FOR DELETE
USING (
  public.is_message_sender(message_id, auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
);

-- ============ message_attachments ============
DROP POLICY IF EXISTS matt_select ON public.message_attachments;
CREATE POLICY matt_select ON public.message_attachments FOR SELECT
USING (
  public.is_message_sender(message_id, auth.uid())
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
  OR public.is_message_recipient(message_id, auth.uid())
);

DROP POLICY IF EXISTS matt_insert ON public.message_attachments;
CREATE POLICY matt_insert ON public.message_attachments FOR INSERT
WITH CHECK (public.is_message_sender(message_id, auth.uid()));

DROP POLICY IF EXISTS matt_delete ON public.message_attachments;
CREATE POLICY matt_delete ON public.message_attachments FOR DELETE
USING (
  public.is_message_sender(message_id, auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
);

-- ============ announcements ============
DROP POLICY IF EXISTS ann_select ON public.announcements;
CREATE POLICY ann_select ON public.announcements FOR SELECT
USING (
  deleted_at IS NULL AND (
    sender_id = auth.uid()
    OR public.has_role(auth.uid(),'main_admin')
    OR public.has_manage_communications_perm(auth.uid())
    OR public.can_view_announcement(id, auth.uid())
  )
);

-- ============ announcement_targets ============
DROP POLICY IF EXISTS atargets_select ON public.announcement_targets;
CREATE POLICY atargets_select ON public.announcement_targets FOR SELECT
USING (
  public.is_announcement_sender(announcement_id, auth.uid())
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
  OR target_type = 'all'::comm_target_type
  OR (target_type = 'user'::comm_target_type AND target_id = auth.uid())
  OR (target_type = 'department'::comm_target_type
      AND target_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS atargets_insert ON public.announcement_targets;
CREATE POLICY atargets_insert ON public.announcement_targets FOR INSERT
WITH CHECK (public.is_announcement_sender(announcement_id, auth.uid()));

DROP POLICY IF EXISTS atargets_delete ON public.announcement_targets;
CREATE POLICY atargets_delete ON public.announcement_targets FOR DELETE
USING (
  public.is_announcement_sender(announcement_id, auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
);

-- ============ announcement_attachments ============
DROP POLICY IF EXISTS aatt_select ON public.announcement_attachments;
CREATE POLICY aatt_select ON public.announcement_attachments FOR SELECT
USING (
  public.is_announcement_sender(announcement_id, auth.uid())
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
  OR public.can_view_announcement(announcement_id, auth.uid())
);

DROP POLICY IF EXISTS aatt_insert ON public.announcement_attachments;
CREATE POLICY aatt_insert ON public.announcement_attachments FOR INSERT
WITH CHECK (public.is_announcement_sender(announcement_id, auth.uid()));

DROP POLICY IF EXISTS aatt_delete ON public.announcement_attachments;
CREATE POLICY aatt_delete ON public.announcement_attachments FOR DELETE
USING (
  public.is_announcement_sender(announcement_id, auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
);

-- ============ announcement_reads ============
DROP POLICY IF EXISTS areads_select ON public.announcement_reads;
CREATE POLICY areads_select ON public.announcement_reads FOR SELECT
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
  OR public.is_announcement_sender(announcement_id, auth.uid())
);
