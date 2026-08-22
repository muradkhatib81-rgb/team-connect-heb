import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBranchContext } from "@/integrations/supabase/active-branch.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formatEmployeeName } from "@/lib/employee-name";
import { notifyBranchExceptActor } from "@/lib/push-dispatch.server";

async function actorDisplayName(userId: string): Promise<string> {
  const { data: actor } = await supabaseAdmin
    .from("profiles")
    .select("full_name, first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  const name = formatEmployeeName({
    full_name: actor?.full_name,
    first_name: actor?.first_name,
    last_name: actor?.last_name,
  });
  return !name || name === "—" ? "מנהל/ת" : name;
}

/**
 * Management on-shift start/end: everyone in the branch except the actor.
 * Start: DB trigger already inserts in-app rows → Web Push only.
 * End: insert in-app + Web Push.
 */
export const announceManagementOnShiftChange = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({ action: z.enum(["start", "end"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const branchId = context.branchId;
    if (!branchId) return { ok: false as const, reason: "no_branch" };

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("branch_manager") && !roleSet.has("assistant_manager")) {
      return { ok: false as const, reason: "not_manager" };
    }

    const displayName = await actorDisplayName(context.userId);
    const message =
      data.action === "start"
        ? `${displayName} נמצא/ת במשמרת`
        : `${displayName} סיים/ה משמרת`;

    const recipients = await notifyBranchExceptActor({
      branchId,
      excludeUserId: context.userId,
      message,
      url: "/dashboard",
      tag: `mos-${data.action}-${context.userId}-${Date.now()}`,
      insertInApp: data.action === "end",
    });

    return { ok: true as const, recipients };
  });

/**
 * Custody take / return: everyone in the branch except who clicked.
 */
export const announceCustodyChange = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        action: z.enum(["take", "return"]),
        itemName: z.string().trim().min(1).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const branchId = context.branchId;
    if (!branchId) return { ok: false as const, reason: "no_branch" };

    const displayName = await actorDisplayName(context.userId);
    const item = data.itemName.trim();
    const message =
      data.action === "take"
        ? `${displayName} לקח/ה ${item}`
        : `${displayName} החזיר/ה ${item}`;

    const recipients = await notifyBranchExceptActor({
      branchId,
      excludeUserId: context.userId,
      message,
      url: "/dashboard",
      tag: `custody-${data.action}-${context.userId}-${Date.now()}`,
      insertInApp: true,
    });

    return { ok: true as const, recipients };
  });
