/**
 * First-run Platform Owner bootstrap.
 *
 * Uses the Auth Admin API (no confirmation email) so signup never depends on
 * Supabase's built-in mailer / email rate limits. The UI still collects only
 * ID number + password; the synthetic local email is an Auth storage detail.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;
const ID_REGEX = /^\d{5,15}$/;

const bootstrapInput = z.object({
  full_name: z.string().trim().min(1).max(100),
  id_number: z.string().regex(ID_REGEX, "מספר זהות חייב להכיל ספרות בלבד (5–15 ספרות)"),
  password: z.string().min(6).max(72),
});

export const bootstrapPlatformOwner = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => bootstrapInput.parse(raw))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: hasAdmin, error: adminCheckErr } = await supabaseAdmin.rpc("has_main_admin");
    if (adminCheckErr) {
      throw new Error(adminCheckErr.message || "לא ניתן לבדוק אם קיים בעל מערכת");
    }
    if (hasAdmin) {
      throw new Error("כבר קיים בעל מערכת במערכת");
    }

    const email = idEmail(data.id_number);
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        id_number: data.id_number,
        role: "main_admin",
      },
    });

    if (createErr || !created?.user) {
      const msg = createErr?.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate")) {
        throw new Error("כבר קיים משתמש עם מספר זהות זה");
      }
      throw new Error(createErr?.message || "יצירת בעל המערכת נכשלה");
    }

    return { ok: true };
  });
