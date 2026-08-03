-- 0004_app_role: papel de aplicação SEM bypass de RLS.
-- A aplicação NUNCA conecta como superusuário nem como dono das tabelas:
-- superusuários ignoram RLS, o que anularia o isolamento de tenant (ADR-009).
-- Este papel é NOLOGIN (grupo); cada ambiente cria seu usuário LOGIN membro
-- dele, com credencial gerida fora do repositório (SECURITY.md §3).
--
-- Privilégios seguem o princípio do mínimo: sem DELETE em nenhuma tabela
-- (dados clínicos não são apagados; desativação é UPDATE de flag) e
-- audit_event aceita apenas SELECT/INSERT — append-only também por privilégio,
-- além do trigger.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hospital_os_app') THEN
    CREATE ROLE hospital_os_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hospital_os_app;
GRANT SELECT ON tenant TO hospital_os_app;
GRANT SELECT, INSERT, UPDATE ON org_unit, app_user, role_assignment TO hospital_os_app;
GRANT SELECT, INSERT ON audit_event TO hospital_os_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hospital_os_app;
