ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_of_month;
ALTER TABLE public.employee_of_month REPLICA IDENTITY FULL;