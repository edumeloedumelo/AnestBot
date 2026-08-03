-- 0003_audit: trilha de auditoria imutável (F1-E3, ADR-006).
-- Append-only por construção: trigger bloqueia UPDATE/DELETE/TRUNCATE para
-- qualquer papel, inclusive o dono da tabela. Correção = novo evento.
-- Hash encadeado por tenant para evidência de integridade (DATA_MODEL.md §4).

CREATE TABLE audit_event (
  seq            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenant (id),
  actor_id       uuid,
  actor_role     text,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text,
  data           jsonb,
  justification  text,
  source_ip      inet,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  prev_hash      text NOT NULL,
  hash           text NOT NULL
);

CREATE INDEX audit_event_tenant_seq_idx ON audit_event (tenant_id, seq);
CREATE INDEX audit_event_entity_idx ON audit_event (tenant_id, entity_type, entity_id);

CREATE FUNCTION forbid_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: % is forbidden', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_event_tenant_isolation ON audit_event
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
