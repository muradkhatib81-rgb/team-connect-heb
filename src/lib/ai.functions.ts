import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isPlatformOwner, type AppRole } from "@/lib/constants";
import type { AiAssistantKind, AiGrantSource, AiProviderCode, ResolvedAiAccess } from "@/modules/ai";
import { registerAiProvider, routeAiChat } from "@/modules/ai";
import { GeminiProvider } from "@/modules/ai/providers/gemini.provider";
import { aiErrorCode } from "@/lib/ai-errors";

let providersRegistered = false;

function ensureProvidersRegistered() {
  if (providersRegistered) return;
  registerAiProvider(new GeminiProvider());
  providersRegistered = true;
}

type RawAccess = {
  allowed?: boolean;
  reason?: string;
  assistant_kind?: AiAssistantKind;
  provider_code?: AiProviderCode;
  grant_id?: string | null;
  remaining_minutes?: number | null;
  quota_minutes?: number | null;
  grant_source?: AiGrantSource | "platform" | null;
};

function mapAccess(raw: RawAccess): ResolvedAiAccess {
  return {
    allowed: !!raw.allowed,
    grantId: raw.grant_id ?? null,
    providerCode: raw.provider_code ?? "gemini",
    assistantKind: raw.assistant_kind ?? "employee",
    remainingMinutes: raw.remaining_minutes ?? null,
    quotaMinutes: raw.quota_minutes ?? null,
    grantSource: (raw.grant_source as AiGrantSource | null) ?? null,
  };
}

async function assertCanManageAiGrants(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("can_manage_ai_grants", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(aiErrorCode("noManagePermission"));
}

function buildSystemPrompt(kind: AiAssistantKind, locale: string): string {
  const lang =
    locale === "ar" ? "Arabic" : locale === "en" ? "English" : "Hebrew";
  if (kind === "platform_owner") {
    return `You are a platform operations assistant for a workforce management SaaS. Answer in ${lang}. Help with platform overview, companies, branches, and usage — never invent data. If you lack data, say so. Do not change permissions or approve actions — advise only.`;
  }
  if (kind === "manager") {
    return `You are a branch/department manager assistant for a workforce app. Answer in ${lang}. Help summarize operational questions (schedules, leaves, breaks, team status). Never approve or reject requests — explain and guide only.`;
  }
  return `You are an employee self-service assistant for a workforce app. Answer in ${lang}. Help with leave balance, schedule, breaks, and profile questions. Never approve actions — guide the user to the right screen.`;
}

function estimateMinutes(durationMs: number, inputTokens: number, outputTokens: number): number {
  const fromDuration = durationMs / 60_000;
  const fromTokens = (inputTokens + outputTokens) / 1000;
  return Math.max(0.01, Math.round(Math.max(fromDuration, fromTokens * 0.02) * 100) / 100);
}

export const getMyAiAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_my_ai_access");
    if (error) throw new Error(error.message);
    return mapAccess((data ?? {}) as RawAccess);
  });

const chatInput = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(20)
    .optional(),
  locale: z.string().optional(),
});

export const sendAiMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => chatInput.parse(raw))
  .handler(async ({ context, data }) => {
    ensureProvidersRegistered();

    const { data: accessRaw, error: accessErr } = await context.supabase.rpc("get_my_ai_access");
    if (accessErr) throw new Error(accessErr.message);
    const access = mapAccess((accessRaw ?? {}) as RawAccess);
    if (!access.allowed) {
      throw new Error(aiErrorCode("noAccess"));
    }

    const locale = data.locale ?? "he";
    const messages = [
      { role: "system" as const, content: buildSystemPrompt(access.assistantKind, locale) },
      ...(data.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: data.message },
    ];

    const response = await routeAiChat({
      providerCode: access.providerCode,
      messages,
    });

    const minutes = estimateMinutes(response.durationMs, response.inputTokens, response.outputTokens);

    const { error: consumeErr } = await context.supabase.rpc("consume_ai_minutes", {
      _grant_id: access.grantId,
      _minutes: minutes,
      _provider_code: response.providerCode,
      _model: response.model,
      _assistant_kind: access.assistantKind,
      _input_tokens: response.inputTokens,
      _output_tokens: response.outputTokens,
      _duration_ms: response.durationMs,
    });
    if (consumeErr) throw new Error(consumeErr.message);

    return {
      text: response.text,
      remainingMinutes:
        access.remainingMinutes != null
          ? Math.max(0, Math.round((access.remainingMinutes - minutes) * 100) / 100)
          : null,
      providerCode: response.providerCode,
      model: response.model,
    };
  });

export const listAiGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ai_grants")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAiProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ai_providers")
      .select("*")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAiPlanEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { data, error } = await context.supabase.from("ai_plan_entitlements").select("*");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAiUsageEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ai_usage_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertGrantInput = z.object({
  id: z.string().uuid().optional(),
  scopeType: z.enum(["company", "branch", "user"]),
  scopeId: z.string().uuid(),
  providerCode: z.string().nullable().optional(),
  grantSource: z.enum(["manual_free", "manual_paid", "billing_plan"]).default("manual_free"),
  billingPlan: z.enum(["free", "standard", "enterprise"]).nullable().optional(),
  quotaMinutes: z.number().nullable().optional(),
  quotaPeriod: z.enum(["monthly", "lifetime"]).default("monthly"),
  isActive: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

export const upsertAiGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertGrantInput.parse(raw))
  .handler(async ({ context, data }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const row = {
      scope_type: data.scopeType,
      scope_id: data.scopeId,
      provider_code: data.providerCode ?? null,
      grant_source: data.grantSource,
      billing_plan: data.billingPlan ?? null,
      quota_minutes: data.quotaMinutes ?? null,
      quota_period: data.quotaPeriod,
      is_active: data.isActive,
      notes: data.notes ?? null,
      granted_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("ai_grants")
        .update(row)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return updated;
    }

    const { data: inserted, error } = await context.supabase
      .from("ai_grants")
      .upsert(row, { onConflict: "scope_type,scope_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

const grantIdInput = z.object({ id: z.string().uuid() });

export const deleteAiGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => grantIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { error } = await context.supabase.from("ai_grants").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const syncBillingInput = z.object({
  companyId: z.string().uuid(),
  plan: z.enum(["free", "standard", "enterprise"]),
});

/** Sync company AI grant from billing plan entitlements. */
export const syncCompanyAiGrantFromBillingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => syncBillingInput.parse(raw))
  .handler(async ({ context, data }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);

    const { data: ent, error: entErr } = await context.supabase
      .from("ai_plan_entitlements")
      .select("*")
      .eq("billing_plan", data.plan)
      .maybeSingle();
    if (entErr) throw new Error(entErr.message);
    if (!ent) throw new Error(aiErrorCode("planNotFound"));

    const { data: grant, error } = await context.supabase
      .from("ai_grants")
      .upsert(
        {
          scope_type: "company",
          scope_id: data.companyId,
          provider_code: ent.default_provider_code,
          grant_source: "billing_plan",
          billing_plan: data.plan,
          quota_minutes: ent.monthly_minutes,
          quota_period: "monthly",
          is_active: true,
          granted_by: context.userId,
          used_minutes: 0,
          period_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "scope_type,scope_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return grant;
  });

const providerPatchInput = z.object({
  code: z.string(),
  isEnabled: z.boolean(),
});

export const updateAiProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => providerPatchInput.parse(raw))
  .handler(async ({ context, data }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("ai_providers")
      .update({ is_enabled: data.isEnabled, updated_at: new Date().toISOString() })
      .eq("code", data.code)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getAiPlatformSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { data, error } = await context.supabase.from("ai_platform_settings").select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

const platformSettingsInput = z.object({
  defaultProviderCode: z.string(),
  ownerMonthlyMinutes: z.number().nullable(),
  isGloballyEnabled: z.boolean(),
});

export const updateAiPlatformSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => platformSettingsInput.parse(raw))
  .handler(async ({ context, data }) => {
    await assertCanManageAiGrants(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: platform } = await supabaseAdmin.from("platforms").select("id").limit(1).maybeSingle();
    if (!platform?.id) throw new Error("Platform record not found");

    const { data: row, error } = await supabaseAdmin
      .from("ai_platform_settings")
      .upsert(
        {
          platform_id: platform.id,
          default_provider_code: data.defaultProviderCode,
          owner_monthly_minutes: data.ownerMonthlyMinutes,
          is_globally_enabled: data.isGloballyEnabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Resolve assistant kind client-side preview from roles. */
export function resolveAssistantKindFromRoles(roles: readonly AppRole[]): AiAssistantKind {
  if (isPlatformOwner(roles)) return "platform_owner";
  if (
    roles.includes("branch_manager") ||
    roles.includes("assistant_manager") ||
    roles.includes("department_manager")
  ) {
    return "manager";
  }
  return "employee";
}
