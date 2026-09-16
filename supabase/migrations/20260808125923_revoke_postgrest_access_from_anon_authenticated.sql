-- Cierra el acceso vía PostgREST a las tablas del CRM.
--
-- Contexto: las 103 tablas de public tenían RLS deshabilitado Y los roles
-- anon/authenticated con todos los privilegios. Como la anon key viaja en el
-- browser (el botón € del composer llama a las Edge Functions), cualquiera que
-- la extrajera podía leer messages/contacts/access_tokens o hacer TRUNCATE.
--
-- Se revoca en lugar de activar RLS porque ningún consumidor legítimo usa
-- PostgREST: Chatwoot conecta por Postgres directo como owner, y las Edge
-- Functions usan service_role. Verificado el 8-ago-2026 con 24 h de logs de
-- API (sólo tráfico de SupabaseEdgeRuntime y del SDK Ruby contra Storage) y
-- con auth.users = 0 (nadie asume el rol authenticated).
--
-- Rollback: GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
