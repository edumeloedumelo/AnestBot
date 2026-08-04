-- 003_integration — inbox idempotente, outbox da plataforma e auditoria
-- append-only (imutabilidade garantida por TRIGGER, não por convenção).

-- Inbox: cada event_id processado UMA única vez (unique = idempotência).
CREATE TABLE inbox_receipts (
  id            uuid PRIMARY KEY,
  event_id      uuid NOT NULL UNIQUE,
  event_type    text NOT NULL,
  source        text NOT NULL,
  team_id       uuid REFERENCES teams(id) ON DELETE SET NULL,
  chat_ref      text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'failed')),
  error         text NOT NULL DEFAULT '',
  received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbox_receipts_team_idx ON inbox_receipts (team_id, received_at DESC);

-- Outbox da PLATAFORMA (eventos plataforma → bot/terceiros, Marcos 2+).
CREATE TABLE outbox_events (
  id           uuid PRIMARY KEY,
  event_id     uuid NOT NULL UNIQUE,
  event_type   text NOT NULL,
  team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts     integer NOT NULL DEFAULT 0,
  next_at      timestamptz NOT NULL DEFAULT now(),
  dead_at      timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (next_at)
  WHERE delivered_at IS NULL AND dead_at IS NULL;

-- Auditoria append-only: quem fez o quê, quando — SEM conteúdo clínico no meta.
CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY,
  team_id     uuid REFERENCES teams(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (length(action) BETWEEN 3 AND 80),
  entity_type text NOT NULL DEFAULT '',
  entity_id   text NOT NULL DEFAULT '',
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_team_idx ON audit_logs (team_id, created_at DESC);

-- Imutabilidade REAL: UPDATE/DELETE em audit_logs, medical_reviews, overrides
-- e case_analyses são bloqueados no banco (não só por disciplina de código).
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tabela append-only: % em % é proibido', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable      BEFORE UPDATE OR DELETE ON audit_logs      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER medical_reviews_immutable BEFORE UPDATE OR DELETE ON medical_reviews FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER overrides_immutable       BEFORE UPDATE OR DELETE ON overrides       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER case_analyses_immutable   BEFORE UPDATE OR DELETE ON case_analyses   FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
