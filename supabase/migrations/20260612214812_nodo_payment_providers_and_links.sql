-- NODO PATCH 9: Payment Links multi-provider (Stripe Connect / Square futuro)
-- Tabla 1: configuración del provider de pagos por cuenta Chatwoot
CREATE TABLE IF NOT EXISTS nodo_payment_providers (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL,                    -- accounts.id de Chatwoot
  provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'square')),
  connected_account_id TEXT NOT NULL,            -- acct_XXX de Stripe Connect (o merchant_id Square)
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 1.50
    CHECK (commission_percent >= 0 AND commission_percent <= 30),
  currency TEXT NOT NULL DEFAULT 'eur',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'pending_onboarding')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider)
);

-- Tabla 2: auditoría de cada link de pago generado
CREATE TABLE IF NOT EXISTS nodo_payment_links (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  conversation_display_id INTEGER,               -- conv visible donde se generó (opcional)
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_link_id TEXT,                         -- plink_XXX de Stripe
  url TEXT,                                      -- https://buy.stripe.com/...
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  fee_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'eur',
  concept TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'expired', 'cancelled', 'failed')),
  paid_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nodo_payment_links_account ON nodo_payment_links (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nodo_payment_links_provider_link ON nodo_payment_links (provider_link_id);

-- Seed: cuenta de prueba conectada para account 1 (Comunidad Nodo) en test mode
INSERT INTO nodo_payment_providers (account_id, provider, connected_account_id, commission_percent, status, metadata)
VALUES (1, 'stripe', 'acct_1ThcslQ2NYuNfXDm', 1.50, 'active', '{"mode": "test", "note": "cuenta conectada de prueba testaccount@example.com"}'::jsonb)
ON CONFLICT (account_id, provider) DO UPDATE
SET connected_account_id = EXCLUDED.connected_account_id,
    updated_at = now();
