
-- ==========================================
-- Communications Center - Phase 1 Schema
-- Tables: messages, message_recipients, message_targets, message_attachments,
--         announcements, announcement_targets, announcement_attachments,
--         announcement_reads, communications_audit_log
-- ==========================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.comm_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.comm_target_type AS ENUM ('user','department','all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.comm_audit_action AS ENUM (
    'created','edited','deleted','sent','read','acknowledged','restored'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.comm_entity_type AS ENUM ('message','announcement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============== MESSAGES ==============
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  priority public.comm_priority NOT NULL DEFAULT 'normal',
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requires_acknowledgment boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.message_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  archived_at timestamptz,
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON public.message_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_msg ON public.message_recipients(message_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_recipients TO authenticated;
GRANT ALL ON public.message_recipients TO service_role;
ALTER TABLE public.message_recipients ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.message_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  target_type public.comm_target_type NOT NULL,
  target_id uuid
);
GRANT SELECT, INSERT, DELETE ON public.message_targets TO authenticated;
GRANT ALL ON public.message_targets TO service_role;
ALTER TABLE public.message_targets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size bigint,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.message_attachments TO authenticated;
GRANT ALL ON public.message_attachments TO service_role;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- ============== ANNOUNCEMENTS ==============
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  image_url text,
  priority public.comm_priority NOT NULL DEFAULT 'normal',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.announcement_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  target_type public.comm_target_type NOT NULL,
  target_id uuid
);
GRANT SELECT, INSERT, DELETE ON public.announcement_targets TO authenticated;
GRANT ALL ON public.announcement_targets TO service_role;
ALTER TABLE public.announcement_targets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.announcement_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size bigint,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.announcement_attachments TO authenticated;
GRANT ALL ON public.announcement_attachments TO service_role;
ALTER TABLE public.announcement_attachments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.announcement_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON public.announcement_reads(user_id);
GRANT SELECT, INSERT, DELETE ON public.announcement_reads TO authenticated;
GRANT ALL ON public.announcement_reads TO service_role;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

-- ============== AUDIT LOG ==============
CREATE TABLE IF NOT EXISTS public.communications_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type public.comm_entity_type NOT NULL,
  entity_id uuid NOT NULL,
  action public.comm_audit_action NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_audit_entity ON public.communications_audit_log(entity_type, entity_id);
GRANT SELECT, INSERT ON public.communications_audit_log TO authenticated;
GRANT ALL ON public.communications_audit_log TO service_role;
ALTER TABLE public.communications_audit_log ENABLE ROW LEVEL SECURITY;

-- ============== PERMISSION COLUMNS ==============
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_send_messages boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_send_announcements boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_communications boolean NOT NULL DEFAULT false;

-- ============== HELPER FUNCTIONS ==============
CREATE OR REPLACE FUNCTION public.has_send_messages_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR public.has_role(_user_id,'department_manager')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id
                   AND (can_send_messages OR can_manage_communications));
$$;

CREATE OR REPLACE FUNCTION public.has_send_announcements_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id
                   AND (can_send_announcements OR can_manage_communications));
$$;

CREATE OR REPLACE FUNCTION public.has_manage_communications_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id AND can_manage_communications);
$$;

REVOKE EXECUTE ON FUNCTION public.has_send_messages_perm(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.has_send_announcements_perm(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.has_manage_communications_perm(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_send_messages_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_send_announcements_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_manage_communications_perm(uuid) TO authenticated, service_role;

-- ============== RLS POLICIES ==============

-- MESSAGES: sender or recipient or admin can view
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    sender_id = auth.uid()
    OR public.has_role(auth.uid(),'main_admin')
    OR public.has_manage_communications_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.message_recipients mr
               WHERE mr.message_id = id AND mr.user_id = auth.uid())
  )
);
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND public.has_send_messages_perm(auth.uid()));
CREATE POLICY "messages_update" ON public.messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid() OR public.has_manage_communications_perm(auth.uid()))
WITH CHECK (sender_id = auth.uid() OR public.has_manage_communications_perm(auth.uid()));
CREATE POLICY "messages_delete" ON public.messages FOR DELETE TO authenticated
USING (sender_id = auth.uid() OR public.has_manage_communications_perm(auth.uid()));

-- MESSAGE_RECIPIENTS
CREATE POLICY "mrecipients_select" ON public.message_recipients FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
  OR EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
);
CREATE POLICY "mrecipients_insert" ON public.message_recipients FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
);
CREATE POLICY "mrecipients_update" ON public.message_recipients FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
CREATE POLICY "mrecipients_delete" ON public.message_recipients FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
);

-- MESSAGE_TARGETS
CREATE POLICY "mtargets_select" ON public.message_targets FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id
          AND (m.sender_id = auth.uid()
               OR public.has_manage_communications_perm(auth.uid())
               OR EXISTS (SELECT 1 FROM public.message_recipients r
                          WHERE r.message_id = m.id AND r.user_id = auth.uid())))
);
CREATE POLICY "mtargets_insert" ON public.message_targets FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
);
CREATE POLICY "mtargets_delete" ON public.message_targets FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
  OR public.has_manage_communications_perm(auth.uid())
);

-- MESSAGE_ATTACHMENTS - visible to anyone who can see the parent message
CREATE POLICY "matt_select" ON public.message_attachments FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id
    AND (m.sender_id = auth.uid()
         OR public.has_role(auth.uid(),'main_admin')
         OR public.has_manage_communications_perm(auth.uid())
         OR EXISTS (SELECT 1 FROM public.message_recipients r
                    WHERE r.message_id = m.id AND r.user_id = auth.uid())))
);
CREATE POLICY "matt_insert" ON public.message_attachments FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_id = auth.uid()));
CREATE POLICY "matt_delete" ON public.message_attachments FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
       OR public.has_manage_communications_perm(auth.uid()));

-- ANNOUNCEMENTS: visible to authenticated users matching target scope and active window
CREATE POLICY "ann_select" ON public.announcements FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    sender_id = auth.uid()
    OR public.has_role(auth.uid(),'main_admin')
    OR public.has_manage_communications_perm(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.announcement_targets t
      WHERE t.announcement_id = id
        AND (
          t.target_type = 'all'
          OR (t.target_type = 'department'
              AND t.target_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid()))
          OR (t.target_type = 'user' AND t.target_id = auth.uid())
        )
    )
  )
);
CREATE POLICY "ann_insert" ON public.announcements FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND public.has_send_announcements_perm(auth.uid()));
CREATE POLICY "ann_update" ON public.announcements FOR UPDATE TO authenticated
USING (sender_id = auth.uid() OR public.has_manage_communications_perm(auth.uid()))
WITH CHECK (sender_id = auth.uid() OR public.has_manage_communications_perm(auth.uid()));
CREATE POLICY "ann_delete" ON public.announcements FOR DELETE TO authenticated
USING (sender_id = auth.uid() OR public.has_manage_communications_perm(auth.uid()));

-- ANNOUNCEMENT_TARGETS - visible to anyone who can see the parent
CREATE POLICY "atargets_select" ON public.announcement_targets FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id
          AND (a.sender_id = auth.uid()
               OR public.has_manage_communications_perm(auth.uid())
               OR target_type = 'all'
               OR (target_type = 'department'
                   AND target_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid()))
               OR (target_type = 'user' AND target_id = auth.uid())))
);
CREATE POLICY "atargets_insert" ON public.announcement_targets FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id AND a.sender_id = auth.uid()));
CREATE POLICY "atargets_delete" ON public.announcement_targets FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id AND a.sender_id = auth.uid())
       OR public.has_manage_communications_perm(auth.uid()));

-- ANNOUNCEMENT_ATTACHMENTS
CREATE POLICY "aatt_select" ON public.announcement_attachments FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id
    AND (a.sender_id = auth.uid()
         OR public.has_manage_communications_perm(auth.uid())
         OR EXISTS (SELECT 1 FROM public.announcement_targets t
                    WHERE t.announcement_id = a.id
                      AND (t.target_type = 'all'
                           OR (t.target_type='department'
                               AND t.target_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid()))
                           OR (t.target_type='user' AND t.target_id = auth.uid())))))
);
CREATE POLICY "aatt_insert" ON public.announcement_attachments FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id AND a.sender_id = auth.uid()));
CREATE POLICY "aatt_delete" ON public.announcement_attachments FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id AND a.sender_id = auth.uid())
       OR public.has_manage_communications_perm(auth.uid()));

-- ANNOUNCEMENT_READS - user marks own read; sender/admin can view
CREATE POLICY "areads_select" ON public.announcement_reads FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
  OR EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id AND a.sender_id = auth.uid())
);
CREATE POLICY "areads_insert" ON public.announcement_reads FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY "areads_delete" ON public.announcement_reads FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- AUDIT LOG
CREATE POLICY "commaudit_select" ON public.communications_audit_log FOR SELECT TO authenticated
USING (
  actor_id = auth.uid()
  OR public.has_role(auth.uid(),'main_admin')
  OR public.has_manage_communications_perm(auth.uid())
);
CREATE POLICY "commaudit_insert" ON public.communications_audit_log FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);

-- ============== TRIGGERS ==============
CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_announcements_updated_at BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_recipients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_reads;
