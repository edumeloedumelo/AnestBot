-- 005_billing — faturamento: terminologias importadas e versionadas (NUNCA
-- embutimos valores TUSS/CBHPM — cada equipe importa sua base autorizada),
-- valores negociados por convênio em CENTAVOS, entradas com memória de
-- cálculo reproduzível e eventos de pagamento append-only.

-- Importações de terminologia: cada importação é uma VERSÃO com checksum.
CREATE TABLE procedure_imports (
  id           uuid PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source_label text NOT NULL CHECK (length(source_label) BETWEEN 2 AND 200),  -- ex.: "CBHPM 2024 licenciada — contrato X"
  checksum     text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  valid_from   date NOT NULL,
  imported_by  uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procedure_imports_team_idx ON procedure_imports (team_id, created_at DESC);

-- Linhas da importação (versão concreta de cada código).
CREATE TABLE procedure_code_versions (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  import_id   uuid NOT NULL REFERENCES procedure_imports(id) ON DELETE CASCADE,
  code        text NOT NULL CHECK (length(code) BETWEEN 2 AND 20),
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 300),
  port        text NOT NULL CHECK (port ~ '^[0-8][A-Ca-c]?$'),  -- porte anestésico CBHPM (ex.: 3, 5B)
  UNIQUE (import_id, code)
);
CREATE INDEX procedure_code_versions_team_code_idx ON procedure_code_versions (team_id, code);

CREATE TABLE insurers (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, name)
);

-- Valor do PORTE por convênio, em CENTAVOS (bigint) — nunca float.
CREATE TABLE insurer_port_prices (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  insurer_id  uuid NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
  port        text NOT NULL CHECK (port ~ '^[0-8][A-Ca-c]?$'),
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  valid_from  date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insurer_id, port, valid_from)
);

-- Entrada de faturamento: estados a_faturar → enviado → pago | glosado
-- (glosado pode voltar a enviado em recurso). Memória de cálculo em jsonb.
CREATE TABLE billing_entries (
  id           uuid PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id      uuid REFERENCES cases(id),
  record_id    uuid REFERENCES anesthesia_records(id),
  insurer_id   uuid NOT NULL REFERENCES insurers(id),
  status       text NOT NULL DEFAULT 'a_faturar' CHECK (status IN ('a_faturar', 'enviado', 'pago', 'glosado')),
  total_cents  bigint NOT NULL CHECK (total_cents >= 0),
  calc         jsonb NOT NULL,          -- memória de cálculo reproduzível
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_entries_team_idx ON billing_entries (team_id, created_at DESC);
CREATE INDEX billing_entries_team_status_idx ON billing_entries (team_id, status);

-- Itens da entrada: referência à VERSÃO exata do código usado no cálculo.
CREATE TABLE billing_entry_items (
  id                uuid PRIMARY KEY,
  team_id           uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  entry_id          uuid NOT NULL REFERENCES billing_entries(id) ON DELETE CASCADE,
  code_version_id   uuid NOT NULL REFERENCES procedure_code_versions(id),
  position          integer NOT NULL CHECK (position >= 1),
  port              text NOT NULL,
  base_cents        bigint NOT NULL CHECK (base_cents >= 0),
  applied_pct       integer NOT NULL CHECK (applied_pct BETWEEN 0 AND 100),
  amount_cents      bigint NOT NULL CHECK (amount_cents >= 0),
  UNIQUE (entry_id, position)
);

-- Eventos de pagamento: trilha append-only que MOVE o status da entrada.
CREATE TABLE payment_events (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  entry_id    uuid NOT NULL REFERENCES billing_entries(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('enviado', 'pago', 'glosado')),
  amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
  reason      text NOT NULL DEFAULT '',   -- motivo da glosa (obrigatório p/ glosa — validado na API)
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX payment_events_entry_idx ON payment_events (entry_id, occurred_at);

-- Imutabilidade: memória de cálculo e itens NUNCA mudam depois de criados;
-- na entrada, apenas status/updated_at podem mudar. Eventos são append-only.
CREATE FUNCTION billing_entry_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.total_cents <> OLD.total_cents OR NEW.calc <> OLD.calc
     OR NEW.insurer_id <> OLD.insurer_id OR NEW.team_id <> OLD.team_id
     OR coalesce(NEW.case_id::text, '') <> coalesce(OLD.case_id::text, '')
     OR coalesce(NEW.record_id::text, '') <> coalesce(OLD.record_id::text, '') THEN
    RAISE EXCEPTION 'memória de cálculo é imutável: recrie a entrada para recalcular';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER billing_entries_calc_immutable BEFORE UPDATE ON billing_entries FOR EACH ROW EXECUTE FUNCTION billing_entry_guard();
CREATE TRIGGER billing_entry_items_immutable  BEFORE UPDATE OR DELETE ON billing_entry_items FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER payment_events_immutable       BEFORE UPDATE OR DELETE ON payment_events      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER procedure_code_versions_immutable BEFORE UPDATE OR DELETE ON procedure_code_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
