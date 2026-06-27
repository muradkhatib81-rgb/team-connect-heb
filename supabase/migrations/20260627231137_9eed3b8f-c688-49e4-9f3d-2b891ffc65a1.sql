
CREATE POLICY "eom_storage_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'employee-of-month');

CREATE POLICY "eom_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-of-month' AND public.has_manage_employee_of_month_perm(auth.uid()));

CREATE POLICY "eom_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-of-month' AND public.has_manage_employee_of_month_perm(auth.uid()))
  WITH CHECK (bucket_id = 'employee-of-month' AND public.has_manage_employee_of_month_perm(auth.uid()));

CREATE POLICY "eom_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'employee-of-month' AND public.has_manage_employee_of_month_perm(auth.uid()));
