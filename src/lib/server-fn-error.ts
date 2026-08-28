import { ZodError } from "zod";
import i18n from "@/i18n";

/** Extract a user-visible message from TanStack server function / Supabase errors. */
export function extractServerFnErrorMessage(error: unknown, fallback = i18n.t("common.unexpectedError")): string {
  if (!error) return fallback;
  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed && trimmed !== "{}" ? trimmed : fallback;
  }

  if (error instanceof ZodError) {
    const first = error.issues[0];
    if (first?.message) return first.message;
  }

  const candidates: string[] = [];
  if (error instanceof Error && error.message) candidates.push(error.message);
  const rec = error as Record<string, unknown>;
  if (typeof rec.message === "string") candidates.push(rec.message);
  if (typeof rec.data === "string") candidates.push(rec.data);
  const cause = rec.cause as Record<string, unknown> | undefined;
  if (typeof cause?.message === "string") candidates.push(cause.message);
  const nested = rec.error as Record<string, unknown> | undefined;
  if (typeof nested?.message === "string") candidates.push(nested.message);
  if (Array.isArray(rec.issues)) {
    const first = rec.issues[0] as { message?: string } | undefined;
    if (first?.message) candidates.push(first.message);
  }

  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (trimmed && trimmed !== "{}" && trimmed !== "undefined") return trimmed;
  }

  return fallback;
}
