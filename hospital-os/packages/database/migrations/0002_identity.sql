-- 0002_identity: usuários, papéis contextuais e vigência (F1-E2).
-- Senhas: hash (nunca texto puro). MFA TOTP opcional por usuário.

CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant (id),
  email          text NOT NULL,
  full_name      text NOT NULL,
  password_hash  text NOT NULL,
  mfa_secret     text,
  mfa_enabled    boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX app_user_tenant_idx ON app_user (tenant_id);

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;

CREATE POLICY app_user_tenant_isolation ON app_user
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Papel × unidade × vigência: a permissão é contextual (SECURITY.md §2).
-- org_unit_id NULL = papel válido no tenant inteiro (ex.: admin institucional).
CREATE TABLE role_assignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  user_id      uuid NOT NULL REFERENCES app_user (id),
  role         text NOT NULL CHECK (role IN (
                 'admin', 'physician', 'anesthesiologist', 'surgeon',
                 'nurse', 'pharmacist', 'reception', 'billing', 'auditor'
               )),
  org_unit_id  uuid REFERENCES org_unit (id),
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_to     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX role_assignment_user_idx ON role_assignment (user_id);
CREATE INDEX role_assignment_tenant_idx ON role_assignment (tenant_id);

ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignment FORCE ROW LEVEL SECURITY;

CREATE POLICY role_assignment_tenant_isolation ON role_assignment
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
