/**
 * Platform-owner identities (בעל מערכת / בעל המערכת הראשי) are not branch
 * staff. The database enforces that they carry no department and no branch
 * (see enforce_non_employee_membership), while every real employee is
 * provisioned with both.
 *
 * Use this to keep platform owners out of staff directories, headcounts, and
 * employee pickers for every viewer (branch manager, assistant, dept head,
 * employee) — without reading roles (which scoped viewers often cannot see)
 * and without touching any permission or RLS policy.
 */
export function isNonEmployeeIdentity(e: {
  department_id?: string | null;
  branch_id?: string | null;
}): boolean {
  return e.department_id == null && e.branch_id == null;
}
