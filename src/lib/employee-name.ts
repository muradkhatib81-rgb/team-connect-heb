import { toWesternDigits } from "./app-locale.ts";

export type EmployeeNameFields = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  id_number?: string | null;
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

function normalizeSearchText(value: string | null | undefined): string {
  return toWesternDigits(value ?? "").trim().toLowerCase();
}

/** Partial, case-insensitive match on display name and/or national ID digits. */
export function employeeMatchesSearch(p: EmployeeNameFields, term: string): boolean {
  const t = normalizeSearchText(term);
  if (!t) return true;
  const display = normalizeSearchText(formatEmployeeName(p));
  const first = normalizeSearchText(p.first_name);
  const last = normalizeSearchText(p.last_name);
  const full = normalizeSearchText(p.full_name);
  const id = normalizeSearchText(p.id_number);
  return display.includes(t) || first.includes(t) || last.includes(t) || full.includes(t) || id.includes(t);
}

export function filterEmployeesByNameOrId<T extends EmployeeNameFields>(
  items: T[],
  term: string,
): T[] {
  const t = term.trim();
  if (!t) return items;
  return items.filter((item) => employeeMatchesSearch(item, t));
}
