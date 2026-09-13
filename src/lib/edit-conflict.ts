import i18n from "@/i18n";

export class EditConflictError extends Error {
  readonly code = "EDIT_CONFLICT" as const;
  readonly editorName: string;
  readonly editorId: string | null;

  constructor(editorName: string, editorId: string | null = null) {
    super(i18n.t("network.conflictEditedBy", { name: editorName }));
    this.name = "EditConflictError";
    this.editorName = editorName;
    this.editorId = editorId;
  }
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  const am = toMs(a);
  const bm = toMs(b);
  if (am == null || bm == null) return false;
  // Tolerate 1s clock/rounding differences between client ISO and DB timestamptz
  return Math.abs(am - bm) < 1000;
}

async function resolveEditorName(
  supabase: { from: (t: string) => any },
  editorId: string | null,
): Promise<string> {
  if (!editorId) return i18n.t("network.conflictSomeone");
  const { data } = await supabase
    .from("profiles")
    .select("full_name, first_name, last_name")
    .eq("id", editorId)
    .maybeSingle();
  const full = (data?.full_name as string | undefined)?.trim();
  if (full) return full;
  const joined = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim();
  return joined || i18n.t("network.conflictSomeone");
}

/**
 * Optimistic lock: reject save when the row changed since the client loaded it.
 * Branch isolation is enforced by callers (requireBranchContext + RLS on the row id).
 */
export async function assertFreshEdit(opts: {
  supabase: { from: (t: string) => any };
  table: string;
  id: string;
  expectedUpdatedAt: string | null | undefined;
  actorUserId: string;
  updatedAtColumn?: string;
  updatedByColumn?: string;
}): Promise<void> {
  const {
    supabase,
    table,
    id,
    expectedUpdatedAt,
    actorUserId,
    updatedAtColumn = "updated_at",
    updatedByColumn = "updated_by",
  } = opts;

  // Gradual rollout: older clients without the field keep working.
  if (expectedUpdatedAt == null || expectedUpdatedAt === "") return;

  const { data, error } = await supabase
    .from(table)
    .select(`${updatedAtColumn}, ${updatedByColumn}`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("libErrors.common.notFound"));

  const currentAt = (data as any)[updatedAtColumn] as string | null;
  if (sameInstant(expectedUpdatedAt, currentAt)) return;

  const editorId = ((data as any)[updatedByColumn] as string | null) ?? null;
  if (editorId && editorId === actorUserId) {
    // Same user saved elsewhere (another tab/device) — still treat as conflict so they reload.
  }
  const name = await resolveEditorName(supabase, editorId);
  throw new EditConflictError(name, editorId);
}

export function stampEditMeta(actorUserId: string): { updated_at: string; updated_by: string } {
  return { updated_at: new Date().toISOString(), updated_by: actorUserId };
}
