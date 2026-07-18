export type EmployeeNameFields = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
};

/** Display name: first_name + space + last_name, with full_name fallback. */
export function formatEmployeeName(p: EmployeeNameFields): string {
  const first = (p.first_name ?? "").trim();
  const last = (p.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ");
  if (combined) return combined;
  return (p.full_name ?? "").trim() || "—";
}

export function employeeNameInitial(p: EmployeeNameFields): string {
  const name = formatEmployeeName(p);
  return name !== "—" ? name.charAt(0) : "?";
}

export function splitFullName(fullName: string): { first_name: string; last_name: string } {
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx <= 0) return { first_name: trimmed, last_name: "" };
  return {
    first_name: trimmed.slice(0, spaceIdx),
    last_name: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export function employeeMatchesSearch(p: EmployeeNameFields, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const display = formatEmployeeName(p).toLowerCase();
  return (
    display.includes(t) ||
    (p.first_name ?? "").toLowerCase().includes(t) ||
    (p.last_name ?? "").toLowerCase().includes(t) ||
    (p.full_name ?? "").toLowerCase().includes(t)
  );
}
