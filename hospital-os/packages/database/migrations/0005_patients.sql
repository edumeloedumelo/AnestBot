-- 0005_patients: cadastro mestre de pacientes com suporte a deduplicação
-- (F1-E5). Identificação segura: prontuário (mrn) sequencial por tenant,
-- CPF único entre pacientes ativos, nome normalizado indexado para busca.
-- Mesclagem preserva os dois registros: o de origem fica inativo apontando
-- para o destino via merged_into (nada é apagado).

CREATE TABLE patient (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant (id),
  mrn              text NOT NULL,
  full_name        text NOT NULL,
  name_normalized  text NOT NULL,
  birth_date       date NOT NULL,
  sex              text NOT NULL DEFAULT 'U' CHECK (sex IN ('F', 'M', 'O', 'U')),
  cpf              text CHECK (cpf ~ '^[0-9]{11}$'),
  cns              text CHECK (cns ~ '^[0-9]{15}$'),
  phone            text,
  active           boolean NOT NULL DEFAULT true,
  merged_into      uuid REFERENCES patient (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mrn),
  CHECK (merged_into IS NULL OR active = false)
);

-- Dois pacientes ativos não podem compartilhar CPF; a mesclagem (active=false)
-- libera o documento para o registro sobrevivente.
CREATE UNIQUE INDEX patient_tenant_cpf_uq ON patient (tenant_id, cpf) WHERE cpf IS NOT NULL AND active;
CREATE INDEX patient_tenant_name_idx ON patient (tenant_id, name_normalized);
CREATE INDEX patient_tenant_birth_idx ON patient (tenant_id, birth_date);

ALTER TABLE patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_tenant_isolation ON patient
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Contadores por tenant (prontuário sequencial, futuros números de atendimento).
CREATE TABLE tenant_counter (
  tenant_id  uuid NOT NULL REFERENCES tenant (id),
  name       text NOT NULL,
  value      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, name)
);

ALTER TABLE tenant_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_counter FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_counter_isolation ON tenant_counter
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON patient, tenant_counter TO hospital_os_app;
