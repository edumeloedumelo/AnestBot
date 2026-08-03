-- 0010_domain_events: outbox de eventos de domínio (ARCHITECTURE.md §4).
-- O evento é escrito NA MESMA transação da escrita de negócio (outbox
-- pattern) e publicado depois por um poller — o mapa em tempo real nunca
-- mostra um evento de uma transação que não foi commitada.
--
-- Sem RLS, deliberadamente: é tabela de infraestrutura lida pelo publisher
-- de forma cross-tenant. Em compensação: (1) payloads são MÍNIMOS —
-- identificadores e status, nunca nome de paciente nem dado clínico;
-- (2) a entrega ao cliente é filtrada por tenant no gateway WebSocket,
-- que autentica por JWT. Registrado no THREAT_MODEL.md.

CREATE TABLE domain_event (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenant (id),
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);

CREATE INDEX domain_event_unpublished_idx ON domain_event (id) WHERE published_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON domain_event TO hospital_os_app;
