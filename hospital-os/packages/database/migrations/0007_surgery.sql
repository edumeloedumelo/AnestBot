-- 0007_surgery: domínio cirúrgico (F2-E1/E2/E3).
-- Caso cirúrgico com jornada de status, equipe, procedimentos vigentes e
-- agendamento sala × intervalo. Dois casos não-cancelados NUNCA ocupam a
-- mesma sala em horários sobrepostos — garantido por constraint de exclusão
-- no banco (a mesma técnica da vigência de procedimentos), não só pela
-- aplicação: é a defesa contra o conflito de mapa clássico dos legados.

CREATE TABLE surgery_case (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant (id),
  patient_id            uuid NOT NULL REFERENCES patient (id),
  insurer_id            uuid REFERENCES insurer (id),
  laterality            text NOT NULL CHECK (laterality IN ('left', 'right', 'bilateral', 'not_applicable')),
  status                text NOT NULL DEFAULT 'requested' CHECK (status IN (
                          'requested', 'authorized', 'confirmed', 'in_preparation',
                          'in_room', 'in_pacu', 'completed', 'cancelled')),
  expected_duration_min integer NOT NULL CHECK (expected_duration_min > 0),
  room_id               uuid REFERENCES org_unit (id),
  scheduled_range       tstzrange,
  -- Itens críticos: NULL = situação indefinida (bloqueia confirmação).
  opme_status           text CHECK (opme_status IN ('not_needed', 'requested', 'confirmed')),
  blood_reserve         text CHECK (blood_reserve IN ('not_needed', 'reserved')),
  icu_reserve           text CHECK (icu_reserve IN ('not_needed', 'reserved')),
  consent_registered    boolean NOT NULL DEFAULT false,
  cancel_reason         text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_range IS NULL OR room_id IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  CONSTRAINT surgery_case_room_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    room_id WITH =,
    scheduled_range WITH &&
  ) WHERE (room_id IS NOT NULL AND scheduled_range IS NOT NULL AND status <> 'cancelled')
);

CREATE INDEX surgery_case_tenant_status_idx ON surgery_case (tenant_id, status);
CREATE INDEX surgery_case_patient_idx ON surgery_case (patient_id);
CREATE INDEX surgery_case_range_idx ON surgery_case USING gist (scheduled_range);

ALTER TABLE surgery_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE surgery_case FORCE ROW LEVEL SECURITY;
CREATE POLICY surgery_case_tenant_isolation ON surgery_case
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Procedimentos do caso: referência à VIGÊNCIA específica (procedure_code.id),
-- congelando o que valia na data — requisito de faturamento e auditoria.
CREATE TABLE case_procedure (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant (id),
  case_id            uuid NOT NULL REFERENCES surgery_case (id),
  procedure_code_id  uuid NOT NULL REFERENCES procedure_code (id),
  is_primary         boolean NOT NULL DEFAULT false,
  UNIQUE (case_id, procedure_code_id)
);

CREATE INDEX case_procedure_case_idx ON case_procedure (case_id);
ALTER TABLE case_procedure ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_procedure FORCE ROW LEVEL SECURITY;
CREATE POLICY case_procedure_tenant_isolation ON case_procedure
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Equipe do caso. user_id opcional (profissional pode ainda não ter login).
CREATE TABLE case_team_member (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant (id),
  case_id    uuid NOT NULL REFERENCES surgery_case (id),
  user_id    uuid REFERENCES app_user (id),
  name       text NOT NULL,
  role       text NOT NULL CHECK (role IN ('surgeon', 'anesthesiologist', 'assistant', 'nurse', 'instrumentator'))
);

CREATE INDEX case_team_member_case_idx ON case_team_member (case_id);
CREATE INDEX case_team_member_name_idx ON case_team_member (tenant_id, role, name);
ALTER TABLE case_team_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_team_member FORCE ROW LEVEL SECURITY;
CREATE POLICY case_team_member_tenant_isolation ON case_team_member
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Jornada perioperatória: linha do tempo de status consultável pelo domínio
-- (indicadores de tempo dependem dela). A trilha probatória continua sendo
-- audit_event; esta tabela é o modelo de negócio.
CREATE TABLE case_status_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  case_id      uuid NOT NULL REFERENCES surgery_case (id),
  from_status  text,
  to_status    text NOT NULL,
  changed_by   uuid,
  justification text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_status_event_case_idx ON case_status_event (case_id, occurred_at);
ALTER TABLE case_status_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_status_event FORCE ROW LEVEL SECURITY;
CREATE POLICY case_status_event_tenant_isolation ON case_status_event
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON surgery_case, case_procedure, case_team_member, case_status_event TO hospital_os_app;
