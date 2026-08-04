-- 006_knowledge — biblioteca clínica: protocolos em Markdown VERSIONADOS
-- (autor, aprovador médico, estado draft/approved/retired), com distinção
-- entre protocolo institucional e referência externa, e busca em português.

CREATE TABLE topics (
  id              uuid PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  kind            text NOT NULL CHECK (kind IN ('institutional', 'external_reference')),
  current_version integer,                 -- última versão APROVADA (NULL = nenhuma)
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, slug)
);

CREATE TABLE topic_versions (
  id           uuid PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  topic_id     uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version >= 1),
  title        text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  content_md   text NOT NULL CHECK (length(content_md) BETWEEN 10 AND 200000),
  source_label text NOT NULL DEFAULT '',  -- obrigatório p/ referência externa (validado na API)
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  author_id    uuid NOT NULL REFERENCES users(id),
  approved_by  uuid REFERENCES users(id),
  approved_crm text,                      -- CRM do aprovador médico
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Busca em português no título + conteúdo.
  search tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', title || ' ' || content_md)) STORED,
  UNIQUE (topic_id, version)
);
CREATE INDEX topic_versions_search_idx ON topic_versions USING GIN (search);
CREATE INDEX topic_versions_topic_idx ON topic_versions (topic_id, version DESC);

-- Conteúdo publicado nunca é reescrito: uma versão aprovada só transita para
-- retired (correção = versão nova). Draft pode ser editado livremente.
CREATE FUNCTION topic_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'versão publicada é imutável: DELETE proibido';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'approved' AND (NEW.title <> OLD.title OR NEW.content_md <> OLD.content_md OR NEW.source_label <> OLD.source_label) THEN
    RAISE EXCEPTION 'versão aprovada é imutável: crie uma versão nova';
  END IF;
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'versão aposentada é imutável';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER topic_versions_guard BEFORE UPDATE OR DELETE ON topic_versions FOR EACH ROW EXECUTE FUNCTION topic_version_guard();
