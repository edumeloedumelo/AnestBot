-- 0008_checklist: checklist de cirurgia segura (F2-E4, OMS adaptado §6.4).
-- Uma execução por fase por caso; cada resposta registra item, resposta e
-- justificativa. Não conformidade (resposta 'no') SEM justificativa é
-- impossível no banco, não só na aplicação.

CREATE TABLE checklist_execution (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant (id),
  case_id       uuid NOT NULL REFERENCES surgery_case (id),
  phase         text NOT NULL CHECK (phase IN ('sign_in', 'time_out', 'sign_out')),
  executed_by   uuid,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, phase)
);

CREATE INDEX checklist_execution_case_idx ON checklist_execution (case_id);
ALTER TABLE checklist_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_execution FORCE ROW LEVEL SECURITY;
CREATE POLICY checklist_execution_tenant_isolation ON checklist_execution
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE checklist_answer (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant (id),
  execution_id   uuid NOT NULL REFERENCES checklist_execution (id),
  item           text NOT NULL,
  answer         text NOT NULL CHECK (answer IN ('yes', 'no', 'not_applicable')),
  justification  text,
  CHECK (answer <> 'no' OR justification IS NOT NULL)
);

CREATE INDEX checklist_answer_execution_idx ON checklist_answer (execution_id);
ALTER TABLE checklist_answer ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_answer FORCE ROW LEVEL SECURITY;
CREATE POLICY checklist_answer_tenant_isolation ON checklist_answer
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Checklist executado é registro clínico: sem UPDATE (correção = anotação em
-- nova fase/auditoria), sem DELETE.
GRANT SELECT, INSERT ON checklist_execution, checklist_answer TO hospital_os_app;
