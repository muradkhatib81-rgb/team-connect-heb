
-- 1. New permission column
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_view_read_receipts boolean NOT NULL DEFAULT false;

-- 2. Permission helper
CREATE OR REPLACE FUNCTION public.has_view_read_receipts_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id AND can_view_read_receipts = true);
$$;

REVOKE EXECUTE ON FUNCTION public.has_view_read_receipts_perm(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_view_read_receipts_perm(uuid) TO authenticated;

-- 3. Read receipts for a message
CREATE OR REPLACE FUNCTION public.get_message_read_receipts(_message_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  department_name text,
  job_title text,
  read_at timestamptz,
  acknowledged_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _sender uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  SELECT sender_id INTO _sender FROM public.messages WHERE id = _message_id;
  IF _sender IS NULL THEN
    RAISE EXCEPTION 'הודעה לא נמצאה';
  END IF;
  IF _sender <> _caller
     AND NOT public.has_view_read_receipts_perm(_caller) THEN
    RAISE EXCEPTION 'אין הרשאה לצפייה באישורי קריאה';
  END IF;
  RETURN QUERY
    SELECT mr.user_id,
           p.full_name,
           d.name AS department_name,
           p.job_title,
           mr.read_at,
           mr.acknowledged_at
    FROM public.message_recipients mr
    JOIN public.profiles p ON p.id = mr.user_id
    LEFT JOIN public.departments d ON d.id = p.department_id
    WHERE mr.message_id = _message_id
    ORDER BY (mr.read_at IS NULL), p.full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_message_read_receipts(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_message_read_receipts(uuid) TO authenticated;

-- 4. Read receipts for an announcement (resolves targets dynamically)
CREATE OR REPLACE FUNCTION public.get_announcement_read_receipts(_ann_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  department_name text,
  job_title text,
  read_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _sender uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  SELECT sender_id INTO _sender FROM public.announcements WHERE id = _ann_id;
  IF _sender IS NULL THEN
    RAISE EXCEPTION 'הכרזה לא נמצאה';
  END IF;
  IF _sender <> _caller
     AND NOT public.has_view_read_receipts_perm(_caller) THEN
    RAISE EXCEPTION 'אין הרשאה לצפייה באישורי קריאה';
  END IF;

  RETURN QUERY
  WITH targeted AS (
    SELECT DISTINCT p.id
    FROM public.announcement_targets t
    JOIN public.profiles p
      ON p.is_active = true
     AND (
       t.target_type = 'all'::comm_target_type
       OR (t.target_type = 'user'::comm_target_type AND p.id = t.target_id)
       OR (t.target_type = 'department'::comm_target_type AND p.department_id = t.target_id)
     )
    WHERE t.announcement_id = _ann_id
  )
  SELECT tg.id,
         p.full_name,
         d.name,
         p.job_title,
         ar.read_at
  FROM targeted tg
  JOIN public.profiles p ON p.id = tg.id
  LEFT JOIN public.departments d ON d.id = p.department_id
  LEFT JOIN public.announcement_reads ar
    ON ar.announcement_id = _ann_id AND ar.user_id = tg.id
  ORDER BY (ar.read_at IS NULL), p.full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_announcement_read_receipts(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_read_receipts(uuid) TO authenticated;

-- 5. Grant the permission to existing main admins automatically
UPDATE public.user_task_permissions utp
SET can_view_read_receipts = true
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = utp.user_id AND ur.role = 'main_admin'
);
