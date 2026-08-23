-- Platform-owner Web Push toggles. Silent in-app bell is unaffected.
-- Default: all events enabled (push on). Only platform owners manage this table.

CREATE TABLE IF NOT EXISTS public.platform_push_settings (
  event_key text PRIMARY KEY,
  push_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

REVOKE ALL ON public.platform_push_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_push_settings TO authenticated;
GRANT ALL ON public.platform_push_settings TO service_role;

ALTER TABLE public.platform_push_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_push_settings_select ON public.platform_push_settings;
CREATE POLICY platform_push_settings_select ON public.platform_push_settings
  FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS platform_push_settings_write ON public.platform_push_settings;
CREATE POLICY platform_push_settings_write ON public.platform_push_settings
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

INSERT INTO public.platform_push_settings (event_key, push_enabled) VALUES
  ('schedule_update', true),
  ('schedule_publish', true),
  ('schedule_approve', true),
  ('schedule_reject', true),
  ('leave_request', true),
  ('leave_decision', true),
  ('leave_cancel', true),
  ('break_start', true),
  ('break_end', true),
  ('break_late', true),
  ('break_approval', true),
  ('custody_take', false),
  ('custody_return', false),
  ('management_on_shift', true),
  ('tasks', true),
  ('messages', true)
ON CONFLICT (event_key) DO NOTHING;

-- Explicit grants: platform owner enables Push for a company and/or a branch.
-- Empty table = all branches allowed (until the first grant is added).
CREATE TABLE IF NOT EXISTS public.platform_push_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT platform_push_scopes_one_target CHECK (
    (company_id IS NOT NULL AND branch_id IS NULL)
    OR (company_id IS NULL AND branch_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_push_scopes_company_uidx
  ON public.platform_push_scopes (company_id)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS platform_push_scopes_branch_uidx
  ON public.platform_push_scopes (branch_id)
  WHERE branch_id IS NOT NULL;

REVOKE ALL ON public.platform_push_scopes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_push_scopes TO authenticated;
GRANT ALL ON public.platform_push_scopes TO service_role;

ALTER TABLE public.platform_push_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_push_scopes_select ON public.platform_push_scopes;
CREATE POLICY platform_push_scopes_select ON public.platform_push_scopes
  FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS platform_push_scopes_write ON public.platform_push_scopes;
CREATE POLICY platform_push_scopes_write ON public.platform_push_scopes
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION public.is_platform_push_event_enabled(_event_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT push_enabled FROM public.platform_push_settings WHERE event_key = _event_key),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_push_scope_allowed(_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_scopes boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.platform_push_scopes WHERE enabled IS TRUE)
    INTO v_has_scopes;
  -- No grants yet → allow everywhere (safe until owner starts scoping).
  IF NOT v_has_scopes THEN
    RETURN true;
  END IF;
  IF _branch_id IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_push_scopes s
    WHERE s.enabled IS TRUE AND s.branch_id = _branch_id
  ) THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.platform_push_scopes s
    JOIN public.company_branch_assignments a
      ON a.company_id = s.company_id
     AND a.deleted_at IS NULL
    WHERE s.enabled IS TRUE
      AND s.company_id IS NOT NULL
      AND a.source_branch_id = _branch_id
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_push_enabled(_event_key text, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_push_event_enabled(_event_key)
     AND public.is_platform_push_scope_allowed(_branch_id);
$$;

-- Back-compat single-arg wrapper used by older callers if any.
CREATE OR REPLACE FUNCTION public.is_platform_push_enabled(_event_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_push_enabled(_event_key, NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.is_platform_push_event_enabled(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_push_event_enabled(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_platform_push_scope_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_push_scope_allowed(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_platform_push_enabled(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_push_enabled(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_platform_push_enabled(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_push_enabled(text) TO authenticated, service_role;

-- Restore app push hook (was no-op). Used by DB notifiers when event is enabled.
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
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_push_dispatch_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_push_dispatch_hook(jsonb) TO service_role;

-- Insert in-app row always; Web Push only when platform owner enabled the event.
CREATE OR REPLACE FUNCTION public.notify_with_platform_push(
  _user_id uuid,
  _message text,
  _branch_id uuid,
  _event_key text,
  _schedule_id uuid DEFAULT NULL,
  _title text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL OR NULLIF(btrim(_message), '') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (_user_id, _schedule_id, btrim(_message), _branch_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF public.is_platform_push_enabled(_event_key, _branch_id) THEN
    PERFORM public.invoke_push_dispatch_hook(jsonb_build_object(
      'userIds', jsonb_build_array(_user_id::text),
      'message', btrim(_message),
      'title', COALESCE(NULLIF(btrim(_title), ''), 'מערכת ניהול עובדים'),
      'tag', _event_key || '-' || _user_id::text || '-' || extract(epoch from now())::bigint::text,
      'url', '/dashboard'
    ));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_with_platform_push(uuid, text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_with_platform_push(uuid, text, uuid, text, uuid, text) TO authenticated, service_role;

-- Leave employee decision/cancel: silent bell + optional push
CREATE OR REPLACE FUNCTION public.notify_leave_employee(
  _user_id uuid,
  _branch_id uuid,
  _message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_with_platform_push(
    _user_id,
    _message,
    _branch_id,
    'leave_decision',
    NULL,
    'עדכון חופשה'
  );
END;
$$;

-- Break approvers: in-app + optional push (does not change who can approve)
CREATE OR REPLACE FUNCTION public.notify_break_approvers(_req public.break_requests)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee text;
  v_break_type text;
  v_start text;
  v_msg text;
  v_uid uuid;
BEGIN
  SELECT COALESCE(p.full_name, 'עובד') INTO v_employee FROM public.profiles p WHERE p.id = _req.user_id;
  SELECT COALESCE(bs.name, 'הפסקה') INTO v_break_type FROM public.break_settings bs WHERE bs.id = _req.break_setting_id;
  v_start := to_char(COALESCE(_req.planned_start, _req.requested_at) AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI');
  v_msg := format('בקשת הפסקה חדשה: %s · %s · התחלה %s · %s דק׳',
    v_employee, v_break_type, v_start, COALESCE(_req.planned_duration, _req.duration_minutes));

  FOR v_uid IN
    SELECT DISTINCT u.id FROM auth.users u
    JOIN public.profiles pr ON pr.id = u.id
    WHERE pr.is_active IS DISTINCT FROM false
      AND public.can_approve_break_by_policy(u.id)
      AND u.id <> _req.user_id
  LOOP
    PERFORM public.notify_with_platform_push(
      v_uid, v_msg, _req.branch_id, 'break_approval', NULL, 'בקשת הפסקה'
    );
  END LOOP;
END;
$$;

-- Leave request → notify existing approvers only (dept head / leave approvers). No permission changes.
CREATE OR REPLACE FUNCTION public.trg_leave_request_created_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee text;
  v_msg text;
  v_uid uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text NOT IN ('pending_dept', 'pending_admin') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'עובד') INTO v_employee
  FROM public.profiles WHERE id = NEW.user_id;
  v_msg := format('בקשת חופשה חדשה מ-%s · %s עד %s', v_employee, NEW.start_date, NEW.end_date);

  IF NEW.status::text = 'pending_dept' THEN
    FOR v_uid IN
      SELECT d.manager_id
      FROM public.departments d
      WHERE d.id = NEW.department_id
        AND d.manager_id IS NOT NULL
        AND d.manager_id <> NEW.user_id
    LOOP
      PERFORM public.notify_with_platform_push(
        v_uid, v_msg, NEW.branch_id, 'leave_request', NULL, 'בקשת חופשה'
      );
    END LOOP;
  END IF;

  FOR v_uid IN
    SELECT DISTINCT p.id
    FROM public.profiles p
    JOIN public.user_task_permissions utp ON utp.user_id = p.id
    WHERE p.branch_id = NEW.branch_id
      AND p.is_active IS DISTINCT FROM false
      AND p.id <> NEW.user_id
      AND (utp.can_approve_leave IS TRUE OR utp.can_reject_leave IS TRUE)
  LOOP
    PERFORM public.notify_with_platform_push(
      v_uid, v_msg, NEW.branch_id, 'leave_request', NULL, 'בקשת חופשה'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_request_created_notify ON public.leave_requests;
CREATE TRIGGER trg_leave_request_created_notify
  AFTER INSERT ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_leave_request_created_notify();

-- Late break return: push holder when still active past ends_at (idempotent stamp).
ALTER TABLE public.break_requests
  ADD COLUMN IF NOT EXISTS late_return_notified_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.process_break_late_return_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count int := 0;
  v_msg text;
BEGIN
  FOR r IN
    SELECT id, user_id, branch_id, ends_at
    FROM public.break_requests
    WHERE status = 'active'::public.break_request_status
      AND ends_at IS NOT NULL
      AND ends_at < now()
      AND late_return_notified_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.break_requests
       SET late_return_notified_at = now()
     WHERE id = r.id
       AND late_return_notified_at IS NULL;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_msg := 'התעכבת בחזרה מההפסקה — נא לחזור לעבודה';
    PERFORM public.notify_with_platform_push(
      r.user_id, v_msg, r.branch_id, 'break_late', NULL, 'איחור בהפסקה'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_break_late_return_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_break_late_return_alerts() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-break-late-return-alerts') THEN
    PERFORM cron.unschedule('process-break-late-return-alerts');
  END IF;
  PERFORM cron.schedule(
    'process-break-late-return-alerts',
    '* * * * *',
    $CRON$ SELECT public.process_break_late_return_alerts(); $CRON$
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Break start: use platform push helper (in-app always; push if event+scope allow)
CREATE OR REPLACE FUNCTION public.activate_due_break_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_start timestamptz;
  v_dur int;
  v_count int := 0;
  v_seen uuid[] := '{}';
BEGIN
  FOR r IN
    SELECT *
    FROM public.break_requests
    WHERE status IN (
      'scheduled'::public.break_request_status,
      'approved'::public.break_request_status,
      'waiting_for_start'::public.break_request_status
    )
      AND started_at IS NULL
      AND COALESCE(planned_start, approved_at_time, requested_at) <= now()
    ORDER BY user_id, COALESCE(planned_start, approved_at_time, requested_at) ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    IF r.user_id = ANY (v_seen) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.break_requests active_row
      WHERE active_row.user_id = r.user_id
        AND active_row.status = 'active'::public.break_request_status
    ) THEN
      v_seen := array_append(v_seen, r.user_id);
      CONTINUE;
    END IF;

    v_start := now();
    v_dur := COALESCE(r.planned_duration, r.duration_minutes,
      (SELECT duration_minutes FROM public.break_settings WHERE id = r.break_setting_id));

    UPDATE public.break_requests
       SET status = 'active'::public.break_request_status,
           started_at = v_start,
           actual_start = v_start,
           ends_at = v_start + make_interval(mins => COALESCE(v_dur, 15)),
           start_notified_at = COALESCE(start_notified_at, now()),
           last_modified_at = now()
     WHERE id = r.id;

    PERFORM public.write_break_audit(
      r.id, r.user_id, r.user_id, 'started',
      jsonb_build_object('started_at', v_start, 'ends_at', v_start + make_interval(mins => COALESCE(v_dur, 15))),
      r.branch_id
    );

    PERFORM public.notify_with_platform_push(
      r.user_id,
      'ההפסקה שלך התחילה',
      r.branch_id,
      'break_start',
      NULL,
      'הפסקה'
    );

    v_seen := array_append(v_seen, r.user_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
