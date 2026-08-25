-- Durable billing / Stripe foundation.
-- Additive only. Does NOT alter user_roles, user_task_permissions, or existing RLS.

-- ---------------------------------------------------------------------------
-- 1) Per-company (or platform-wide) billing account
--    company_id NULL = platform-level plan row
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'standard', 'enterprise')),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'stripe')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN (
      'active', 'trialing', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'paused', 'none'
    )),
  stripe_customer_id text NULL,
  stripe_subscription_id text NULL,
  stripe_price_id text NULL,
  current_period_end timestamptz NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  grace_until timestamptz NULL,
  updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_company_uidx
  ON public.billing_accounts (company_id)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_platform_uidx
  ON public.billing_accounts ((true))
  WHERE company_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_stripe_customer_uidx
  ON public.billing_accounts (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_accounts_subscription_idx
  ON public.billing_accounts (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Payment / invoice history (Stripe)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  stripe_invoice_id text NULL,
  stripe_payment_intent_id text NULL,
  amount_cents integer NULL,
  currency text NULL,
  status text NOT NULL DEFAULT 'open',
  paid_at timestamptz NULL,
  hosted_invoice_url text NULL,
  receipt_url text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_invoice_uidx
  ON public.billing_payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_payments_company_idx
  ON public.billing_payments (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3) Webhook idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NULL,
  error_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Privileges + RLS (platform owner read/write; service_role for webhooks)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.billing_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.billing_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.billing_webhook_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.billing_accounts TO authenticated;
GRANT SELECT ON public.billing_payments TO authenticated;
GRANT ALL ON public.billing_accounts TO service_role;
GRANT ALL ON public.billing_payments TO service_role;
GRANT ALL ON public.billing_webhook_events TO service_role;

ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_accounts_owner ON public.billing_accounts;
CREATE POLICY billing_accounts_owner ON public.billing_accounts
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS billing_payments_owner ON public.billing_payments;
CREATE POLICY billing_payments_owner ON public.billing_payments
  FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));

-- Webhook table is service_role only (no authenticated policy).
