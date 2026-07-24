export type AppRole =
  | "system_admin"
  | "main_admin"
  | "branch_manager"
  | "assistant_manager"
  | "department_manager"
  | "employee";

export type Department =
  | "dairy"
  | "meat"
  | "produce"
  | "cashiers"
  | "warehouse"
  | "cleaning"
  | "pricing"
  | "general";

export const ROLE_LABELS: Record<AppRole, string> = {
  system_admin: "בעל המערכת הראשי",
  main_admin: "בעל המערכת",
  branch_manager: "מנהל סניף",
  assistant_manager: "סגן מנהל",
  department_manager: "אחראי מחלקה",
  employee: "עובד",
};

// NOTE: system_admin is intentionally omitted from the standard role picker —
// it is a singleton role, not assignable through the regular admin UI.
export const ROLE_OPTIONS: AppRole[] = [
  "main_admin",
  "branch_manager",
  "assistant_manager",
  "department_manager",
  "employee",
];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  dairy: "חלב",
  meat: "בשר",
  produce: "ירקות ופירות",
  cashiers: "קופות",
  warehouse: "מחסן",
  cleaning: "ניקיון",
  pricing: "מחירים",
  general: "כללי",
};

export const DEPARTMENT_OPTIONS: Department[] = [
  "dairy",
  "meat",
  "produce",
  "cashiers",
  "warehouse",
  "cleaning",
  "pricing",
  "general",
];

export const ADMIN_ROLES: AppRole[] = ["main_admin", "branch_manager", "assistant_manager"];

export function isAdmin(roles: AppRole[]): boolean {
  return roles.some((r) => ADMIN_ROLES.includes(r));
}

/**
 * Branch/company management escalates to the platform owner.
 * Employees and department heads escalate to branch management (הנהלה).
 */
export function isBranchOrCompanyManagementRole(roles: readonly string[]): boolean {
  return roles.some(
    (r) =>
      r === "system_admin" ||
      r === "main_admin" ||
      r === "branch_manager" ||
      r === "assistant_manager",
  );
}

/** Contact instruction for help / missing-access messages, by viewer role. */
export function supportContactInstruction(roles: readonly string[]): string {
  return isBranchOrCompanyManagementRole(roles)
    ? "פנה/י לבעל המערכת"
    : "פנה/י להנהלה";
}

export function canManageUsers(roles: AppRole[]): boolean {
  return roles.includes("main_admin") || roles.includes("branch_manager");
}

export function highestRole(roles: AppRole[]): AppRole | null {
  const priority: AppRole[] = [
    "system_admin",
    "main_admin",
    "branch_manager",
    "assistant_manager",
    "department_manager",
    "employee",
  ];
  for (const r of priority) if (roles.includes(r)) return r;
  return null;
}

export function isSystemAdmin(roles: AppRole[]): boolean {
  return roles.includes("system_admin");
}

export function isPlatformOwner(roles: AppRole[]): boolean {
  return roles.some((r) => r === "system_admin" || r === "main_admin");
}

export const APP_NAME = "מערכת ניהול עובדים";
// Legacy fallback: kept as empty string so no company/branch brand is hardcoded.
// The active branch name is shown dynamically instead (see BranchSubtitle).
export const BRANCH_NAME = "";
