DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'break_policy'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.break_policy;
  END IF;
END
$$;
