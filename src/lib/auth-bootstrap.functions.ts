/**
 * First-run Platform Owner bootstrap.
 *
 * Uses the Auth Admin API (no confirmation email) so signup never depends on
 * Supabase's built-in mailer / email rate limits. The UI still collects only
 * ID number + password; the synthetic local email is an Auth storage detail.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import i18n from "@/i18n";

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;
const ID_REGEX = /^\d{5,15}$/;

const bootstrapInput = z.object({
  first_name: z.string().trim().min(1, i18n.t("libErrors.validation.firstNameRequired")).max(50),
  last_name: z.string().trim().min(1, i18n.t("libErrors.validation.lastNameRequired")).max(50),
  id_number: z.string().regex(ID_REGEX, i18n.t("libErrors.validation.idNumberDigits")),
  password: z.string().min(6).max(72),
});

export const bootstrapPlatformOwner = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => bootstrapInput.parse(raw))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: hasAdmin, error: adminCheckErr } = await supabaseAdmin.rpc("has_main_admin");
    if (adminCheckErr) {
      throw new Error(adminCheckErr.message || i18n.t("libErrors.platformOwners.cannotCheckOwner"));
    }
    if (hasAdmin) {
      throw new Error(i18n.t("libErrors.platformOwners.ownerExists"));
    }

    const email = idEmail(data.id_number);
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        id_number: data.id_number,
        role: "main_admin",
      },
    });

    if (createErr || !created?.user) {
      const msg = createErr?.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate")) {
        throw new Error(i18n.t("libErrors.platformOwners.idExists"));
      }
      throw new Error(createErr?.message || i18n.t("libErrors.platformOwners.bootstrapCreateFailed"));
    }

    return { ok: true };
  });
