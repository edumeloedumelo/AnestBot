-- Schema inicial: tenants, cobrança, provisionamento WhatsApp, config, uso e eventos.

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  contact_phone TEXT,
  plan TEXT NOT NULL DEFAULT 'starter', -- starter | pro | clinica
  status TEXT NOT NULL DEFAULT 'pending_payment',
    -- pending_payment | provisioning | awaiting_pairing | active | past_due | canceled
  is_owner BOOLEAN NOT NULL DEFAULT FALSE, -- dono do app: único com acesso ao painel admin
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status_version INTEGER NOT NULL DEFAULT 0, -- lock otimista pros workers
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nomes de coluna genéricos de propósito (provider_*, não ultramsg_*/meta_*):
-- já trocamos de provedor de mensageria uma vez nesta sessão por um detalhe que
-- só descobrimos tarde (grupos não são suportados pela Cloud API da Meta no
-- volume de uma clínica) — o schema não deveria ficar amarrado ao nome de um
-- fornecedor específico de novo.
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider_instance_id TEXT UNIQUE, -- instance_id da UltraMsg (ou equivalente futuro)
  provider_token_encrypted TEXT, -- criptografado (AES-256-GCM), nunca texto puro
  status TEXT NOT NULL DEFAULT 'pending', -- pending | connected | disconnected
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_configs (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  surgeries JSONB NOT NULL DEFAULT '[]',
  exam_limits JSONB NOT NULL DEFAULT '[]',
  extra_prompt TEXT NOT NULL DEFAULT '',
  admin_numbers TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- 'YYYY-MM'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, period)
);

-- Log mínimo não-identificável: nunca guarda nome de paciente, exame ou anamnese.
CREATE TABLE IF NOT EXISTS triage_audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_final TEXT -- liberado | liberado_com_ressalvas | pendente | nao_liberar | erro
);

-- Log de eventos append-only: fonte de coordenação entre workers.
CREATE TABLE IF NOT EXISTS tenant_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- payment | provisioning | connection | execution
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotência de webhooks (Stripe e Meta reenviam em caso de timeout).
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Heartbeat dos workers: se um travar silenciosamente, isso vira alerta pro dono.
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  last_ok_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tenant_events_tenant ON tenant_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_instance_id ON whatsapp_numbers(provider_instance_id);
