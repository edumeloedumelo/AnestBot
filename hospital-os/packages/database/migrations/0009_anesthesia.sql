-- 0009_anesthesia: módulo de anestesiologia (F2-E5/E6/E7).
-- Avaliação pré-anestésica VERSIONADA (nova versão supersede, nunca apaga);
-- ficha anestésica como linha temporal de eventos APPEND-ONLY (correção é
-- evento de anulação apontando para o original — o original permanece);
-- recuperação pós-anestésica com observações seriadas e alta por critérios.

CREATE TABLE pre_anesthetic_assessment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant (id),
  case_id          uuid NOT NULL REFERENCES surgery_case (id),
  version          integer NOT NULL,
  asa              text NOT NULL CHECK (asa IN ('I', 'II', 'III', 'IV', 'V')),
  payload          jsonb NOT NULL,  -- campos estruturados: comorbidades, medicamentos, alergias, via aérea, escalas
  decision         text NOT NULL CHECK (decision IN ('cleared', 'cleared_with_pending', 'postponed')),
  decision_reason  text,
  signed_by        uuid,
  signed_at        timestamptz NOT NULL DEFAULT now(),
  superseded_by    uuid REFERENCES pre_anesthetic_assessment (id),
  UNIQUE (case_id, version),
  CHECK (decision <> 'postponed' OR decision_reason IS NOT NULL)
);

CREATE INDEX pre_anesthetic_assessment_case_idx ON pre_anesthetic_assessment (case_id);
ALTER TABLE pre_anesthetic_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_anesthetic_assessment FORCE ROW LEVEL SECURITY;
CREATE POLICY pre_anesthetic_assessment_tenant_isolation ON pre_anesthetic_assessment
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE anesthetic_record (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant (id),
  case_id     uuid NOT NULL UNIQUE REFERENCES surgery_case (id),
  technique   text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  closed_by   uuid
);

ALTER TABLE anesthetic_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE anesthetic_record FORCE ROW LEVEL SECURITY;
CREATE POLICY anesthetic_record_tenant_isolation ON anesthetic_record
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE anesthetic_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  record_id    uuid NOT NULL REFERENCES anesthetic_record (id),
  event_type   text NOT NULL CHECK (event_type IN (
                 'drug', 'fluid', 'blood_product', 'milestone', 'clinical', 'vital_sign', 'annotation', 'annulment')),
  occurred_at  timestamptz NOT NULL,           -- momento clínico do evento
  recorded_at  timestamptz NOT NULL DEFAULT now(),  -- momento do registro (difere = retroativo)
  payload      jsonb NOT NULL,
  recorded_by  uuid,
  annuls       uuid REFERENCES anesthetic_event (id),
  CHECK (event_type <> 'annulment' OR annuls IS NOT NULL)
);

CREATE INDEX anesthetic_event_record_idx ON anesthetic_event (record_id, occurred_at);
ALTER TABLE anesthetic_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE anesthetic_event FORCE ROW LEVEL SECURITY;
CREATE POLICY anesthetic_event_tenant_isolation ON anesthetic_event
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE pacu_stay (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenant (id),
  case_id                  uuid NOT NULL UNIQUE REFERENCES surgery_case (id),
  admitted_at              timestamptz NOT NULL DEFAULT now(),
  discharged_at            timestamptz,
  discharged_by            uuid,
  discharge_justification  text  -- obrigatória quando critérios não atingidos (regra na aplicação)
);

ALTER TABLE pacu_stay ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacu_stay FORCE ROW LEVEL SECURITY;
CREATE POLICY pacu_stay_tenant_isolation ON pacu_stay
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE pacu_observation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  stay_id      uuid NOT NULL REFERENCES pacu_stay (id),
  observed_at  timestamptz NOT NULL DEFAULT now(),
  aldrete      integer NOT NULL CHECK (aldrete BETWEEN 0 AND 10),
  pain         integer NOT NULL CHECK (pain BETWEEN 0 AND 10),
  vitals       jsonb NOT NULL,  -- PA, FC, SpO2 etc.
  observed_by  uuid
);

CREATE INDEX pacu_observation_stay_idx ON pacu_observation (stay_id, observed_at);
ALTER TABLE pacu_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacu_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY pacu_observation_tenant_isolation ON pacu_observation
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Ficha anestésica e observações de RPA são registro clínico puro:
-- APPEND-ONLY por privilégio (sem UPDATE). Avaliação, ficha (fechamento) e
-- estadia de RPA (alta) precisam de UPDATE controlado pela aplicação.
GRANT SELECT, INSERT, UPDATE ON pre_anesthetic_assessment, anesthetic_record, pacu_stay TO hospital_os_app;
GRANT SELECT, INSERT ON anesthetic_event, pacu_observation TO hospital_os_app;
