-- 0006_master_data: cadastros mestres para o perioperatório (F1-E4).
-- Procedimentos (TUSS/CBHPM) com VIGÊNCIA: a mesma tabela muda ao longo do
-- tempo e faturamento/autorização dependem do código vigente NA DATA do
-- evento. Duas vigências do mesmo código nunca se sobrepõem — garantido por
-- constraint de exclusão no banco, não só na aplicação.
--
-- Nota de arquitetura: os códigos são escopados por tenant (cada instituição
-- importa/ativa a versão de tabela que usa e pode ter itens negociados).
-- Uma camada de referência global compartilhada pode ser extraída depois sem
-- quebrar este modelo.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE procedure_code (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  code_system  text NOT NULL CHECK (code_system IN ('TUSS', 'CBHPM', 'SIGTAP', 'LOCAL')),
  code         text NOT NULL,
  description  text NOT NULL,
  valid_from   date NOT NULL,
  valid_to     date,  -- NULL = vigente sem data de término
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT procedure_code_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    code_system WITH =,
    code WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  )
);

CREATE INDEX procedure_code_lookup_idx ON procedure_code (tenant_id, code_system, code);
CREATE INDEX procedure_code_description_idx ON procedure_code (tenant_id, description);

ALTER TABLE procedure_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_code FORCE ROW LEVEL SECURITY;

CREATE POLICY procedure_code_tenant_isolation ON procedure_code
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Convênios / operadoras (relação comercial do tenant).
CREATE TABLE insurer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant (id),
  name        text NOT NULL,
  ans_code    text CHECK (ans_code ~ '^[0-9]{6}$'),  -- registro ANS da operadora
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE insurer ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurer FORCE ROW LEVEL SECURITY;

CREATE POLICY insurer_tenant_isolation ON insurer
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON procedure_code, insurer TO hospital_os_app;
