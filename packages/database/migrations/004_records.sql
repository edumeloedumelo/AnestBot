-- 004_records — prontuário anestésico: registro estruturado (fonte de verdade),
-- eventos, sinais vitais, assinatura com hash e adendos.
--
-- Regra central (seção 14 do prompt-mestre): registro ASSINADO é IMUTÁVEL —
-- garantido por TRIGGER no banco, não por convenção. Correções pós-assinatura
-- são adendos vinculados, append-only.

CREATE TABLE record_templates (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  version    integer NOT NULL CHECK (version >= 1),
  content    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- pré-preenchimento de pre/intra/post
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, name, version)
);

CREATE TABLE anesthesia_records (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id     uuid REFERENCES cases(id),
  patient_id  uuid REFERENCES patients(id),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  pre         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ASA, via aérea, alergias, medicações, jejum, consentimento
  intra       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- técnica, acessos, monitorização, fluidos, intercorrências
  post        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- RPA, Aldrete, dor, náusea/vômito, destino
  template_id uuid REFERENCES record_templates(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anesthesia_records_team_idx ON anesthesia_records (team_id, created_at DESC);
CREATE INDEX anesthesia_records_case_idx ON anesthesia_records (case_id);

CREATE TABLE anesthesia_events (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  record_id   uuid NOT NULL REFERENCES anesthesia_records(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('drug', 'airway', 'event', 'note')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  dose        text NOT NULL DEFAULT '',
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anesthesia_events_record_idx ON anesthesia_events (record_id, at);

CREATE TABLE vitals (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  record_id  uuid NOT NULL REFERENCES anesthesia_records(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL,
  hr         integer CHECK (hr IS NULL OR hr BETWEEN 0 AND 400),
  sbp        integer CHECK (sbp IS NULL OR sbp BETWEEN 0 AND 400),
  dbp        integer CHECK (dbp IS NULL OR dbp BETWEEN 0 AND 400),
  spo2       integer CHECK (spo2 IS NULL OR spo2 BETWEEN 0 AND 100),
  temp_c     numeric(4,1) CHECK (temp_c IS NULL OR temp_c BETWEEN 20 AND 45),
  extra      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vitals_record_idx ON vitals (record_id, at);

-- Assinatura: congela o snapshot CANÔNICO e seu sha256. UMA por registro.
CREATE TABLE signatures (
  id           uuid PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  record_id    uuid NOT NULL UNIQUE REFERENCES anesthesia_records(id),
  signer_id    uuid NOT NULL REFERENCES users(id),
  signer_crm   text NOT NULL CHECK (length(signer_crm) >= 4),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  canonical    jsonb NOT NULL,
  signed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE record_addenda (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  record_id  uuid NOT NULL REFERENCES anesthesia_records(id),
  author_id  uuid NOT NULL REFERENCES users(id),
  author_crm text NOT NULL CHECK (length(author_crm) >= 4),
  content    text NOT NULL CHECK (length(content) BETWEEN 5 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX record_addenda_record_idx ON record_addenda (record_id, created_at);

-- ── imutabilidade ───────────────────────────────────────────────────────────
-- Registro assinado: nenhum UPDATE (exceto nada — a transição draft→signed é o
-- ÚLTIMO update permitido) e nenhum DELETE, jamais.
CREATE FUNCTION forbid_signed_record_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'registro assinado é imutável: DELETE proibido';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'registro assinado é imutável: use um adendo';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER anesthesia_records_signed_immutable
  BEFORE UPDATE OR DELETE ON anesthesia_records
  FOR EACH ROW EXECUTE FUNCTION forbid_signed_record_mutation();

-- Eventos/vitais de registro assinado: INSERT/UPDATE/DELETE proibidos.
CREATE FUNCTION forbid_child_of_signed() RETURNS trigger AS $$
DECLARE
  rid uuid;
  st text;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END;
  SELECT status INTO st FROM anesthesia_records WHERE id = rid;
  IF st = 'signed' THEN
    RAISE EXCEPTION 'registro assinado é imutável: % em % proibido', TG_OP, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER anesthesia_events_signed_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON anesthesia_events
  FOR EACH ROW EXECUTE FUNCTION forbid_child_of_signed();
CREATE TRIGGER vitals_signed_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON vitals
  FOR EACH ROW EXECUTE FUNCTION forbid_child_of_signed();

-- Assinaturas e adendos: append-only absolutos (reusa forbid_mutation da 003).
CREATE TRIGGER signatures_immutable     BEFORE UPDATE OR DELETE ON signatures     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER record_addenda_immutable BEFORE UPDATE OR DELETE ON record_addenda FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
