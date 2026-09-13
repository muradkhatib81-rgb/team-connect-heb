-- Batch 19: dual-read company_id on communications SELECT (audit + messages + announcements).
-- SELECT-only. Roles / permission helpers / write policies unchanged.
-- Style matches Batch 18 UTP: keep self/recipient gates; AND dual-read onto admin/manage arms only.
-- Canonical row scope for admin/manage:
--   company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))

-- ---------------------------------------------------------------------------
-- communications_audit_log SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS commaudit_select ON public.communications_audit_log;
CREATE POLICY commaudit_select
ON public.communications_audit_log
FOR SELECT
TO authenticated
USING (
  actor_id = auth.uid()
  OR public.is_platform_owner(auth.uid())
  OR (
    (
      public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.has_manage_communications_perm(auth.uid())
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- messages SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select
ON public.messages
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    sender_id = auth.uid()
    OR public.is_message_recipient(id, auth.uid())
    OR public.is_platform_owner(auth.uid())
    OR (
      (
        public.has_role(auth.uid(), 'main_admin'::public.app_role)
        OR public.has_manage_communications_perm(auth.uid())
      )
      AND (
        company_id IN (SELECT public.my_company_ids())
        OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
      )
    )
  )
);

-- ---------------------------------------------------------------------------
-- announcements SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ann_select ON public.announcements;
CREATE POLICY ann_select
ON public.announcements
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    sender_id = auth.uid()
    OR public.can_view_announcement(id, auth.uid())
    OR public.is_platform_owner(auth.uid())
    OR (
      (
        public.has_role(auth.uid(), 'main_admin'::public.app_role)
        OR public.has_manage_communications_perm(auth.uid())
      )
      AND (
        company_id IN (SELECT public.my_company_ids())
        OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
      )
    )
  )
);
