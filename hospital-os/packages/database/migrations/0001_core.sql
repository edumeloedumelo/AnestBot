-- 0001_core: tenants e estrutura organizacional.
-- Multi-tenancy: banco único com RLS por tenant_id (ADR-009).
-- A aplicação define current_setting('app.tenant_id') por transação.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Hierarquia organizacional: organização > unidade > setor > sala/leito.
CREATE TABLE org_unit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant (id),
  parent_id   uuid REFERENCES org_unit (id),
  kind        text NOT NULL CHECK (kind IN ('organization', 'unit', 'sector', 'room', 'bed')),
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_unit_tenant_idx ON org_unit (tenant_id);
CREATE INDEX org_unit_parent_idx ON org_unit (parent_id);

ALTER TABLE org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit FORCE ROW LEVEL SECURITY;

CREATE POLICY org_unit_tenant_isolation ON org_unit
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
