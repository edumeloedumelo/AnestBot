-- 002_clinical — pacientes, casos, análises, pendências, revisões e overrides.
-- TODO acesso é escopado por team_id (isolamento de tenant nas queries E aqui
-- nas FKs compostas onde importa).

CREATE TABLE patients (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  full_name   text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 160),
  birth_date  date,
  phone       text,
  insurer     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_team_idx ON patients (team_id);
-- Deduplicação ASSISTIDA (nunca fusão automática): índice por nome normalizado
-- ajuda a sugerir duplicatas, sem unique (homônimos existem).
CREATE INDEX patients_team_name_idx ON patients (team_id, lower(full_name));

CREATE TABLE patient_alerts (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('allergy', 'difficult_airway', 'prior_event', 'other')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_alerts_patient_idx ON patient_alerts (patient_id);

-- Máquina de estados do caso (validada na aplicação; CHECK garante o domínio):
-- received → analyzing → analyzed | analysis_failed → reviewed
CREATE TABLE cases (
  id             uuid PRIMARY KEY,
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  patient_id     uuid REFERENCES patients(id),
  chat_ref       text NOT NULL DEFAULT '',
  correlation_id text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received', 'analyzing', 'analyzed', 'analysis_failed', 'reviewed')),
  surgery        text NOT NULL DEFAULT '',
  received_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cases_team_idx ON cases (team_id, received_at DESC);
CREATE INDEX cases_team_status_idx ON cases (team_id, status);
-- Idempotência do inbox por correlação: um caso por (team, correlation_id).
CREATE UNIQUE INDEX cases_team_correlation_uidx ON cases (team_id, correlation_id)
  WHERE correlation_id <> '';

-- Análises são IMUTÁVEIS e versionadas por caso (reanálise = nova linha).
CREATE TABLE case_analyses (
  id           uuid PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id      uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  seq          integer NOT NULL CHECK (seq >= 1),
  patient_name text NOT NULL DEFAULT '',
  surgery      text NOT NULL DEFAULT '',
  anamnesis    text NOT NULL DEFAULT '',
  report_text  text NOT NULL DEFAULT '',
  files        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- attached/failed/oversized/degraded
  errors       jsonb NOT NULL DEFAULT '[]'::jsonb,
  model        text NOT NULL DEFAULT '',
  prompt_rev   text NOT NULL DEFAULT '',
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, seq)
);
CREATE INDEX case_analyses_case_idx ON case_analyses (case_id);

CREATE TABLE case_pending_items (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_by  uuid REFERENCES users(id),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_pending_items_case_idx ON case_pending_items (case_id, status);

-- Revisão MÉDICA: append-only; a decisão final é sempre de um médico
-- identificado (CRM obrigatório — validado na aplicação E aqui).
CREATE TABLE medical_reviews (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  reviewer_crm text NOT NULL CHECK (length(reviewer_crm) >= 4),
  decision    text NOT NULL CHECK (decision IN ('approved', 'blocked', 'needs_items')),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medical_reviews_case_idx ON medical_reviews (case_id, created_at DESC);

-- Override: decisão médica POR CIMA do parecer da IA — exige motivo e CRM.
CREATE TABLE overrides (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  crm         text NOT NULL CHECK (length(crm) >= 4),
  decision    text NOT NULL CHECK (decision IN ('approved', 'blocked')),
  reason      text NOT NULL CHECK (length(reason) BETWEEN 5 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX overrides_case_idx ON overrides (case_id);

CREATE TABLE consents (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('data_processing', 'anesthesia', 'other')),
  granted     boolean NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_patient_idx ON consents (patient_id);
