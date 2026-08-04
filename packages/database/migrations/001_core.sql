-- 001_core — identidade, tenants, sessões e pareamento WhatsApp.
-- Convenções: UUIDs gerados pela APLICAÇÃO (crypto.randomUUID); datas em UTC
-- (timestamptz); dinheiro (futuro) em centavos bigint; FKs sempre explícitas.

CREATE TABLE teams (
  id           uuid PRIMARY KEY,
  name         text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  plan         text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'starter', 'pro', 'business')),
  trial_ends_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE CHECK (position('@' in email) > 1 AND length(email) <= 254),
  password_hash text NOT NULL,
  full_name     text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  crm           text CHECK (crm IS NULL OR length(crm) BETWEEN 4 AND 20),
  mfa_secret    text,                -- TOTP (base32); NULL = MFA desabilitado
  mfa_enabled   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'anesthesiologist', 'secretary', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- Sessões opacas revogáveis: o token NUNCA é armazenado — só o sha256.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Convites de equipe: uso único, com expiração; o token viaja fora do banco.
CREATE TABLE invites (
  id          uuid PRIMARY KEY,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'anesthesiologist', 'secretary', 'viewer')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Pareamento grupo WhatsApp ⇄ tenant. Um chat pertence a NO MÁXIMO um tenant.
CREATE TABLE whatsapp_links (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  chat_ref   text NOT NULL UNIQUE CHECK (length(chat_ref) BETWEEN 3 AND 128),
  label      text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_links_team_idx ON whatsapp_links (team_id);
