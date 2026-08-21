/** Max length for per-day schedule cell notes (enforced in UI + server). */
export const SCHEDULE_NOTE_MAX = 20;

export function trimScheduleNote(value: string | null | undefined): string {
  return value?.trim().slice(0, SCHEDULE_NOTE_MAX) ?? "";
}
