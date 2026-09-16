-- Estados temporales del flujo OAuth (protección CSRF).
--
-- El parámetro `state` se genera al iniciar la autorización y se valida al
-- volver del proveedor. Sin esto, cualquiera podría inducir a un admin a
-- conectar una cuenta de cobro ajena a su CRM.
--
-- Filas de vida corta: se marcan usadas al canjearse y expiran a los 15 min.

CREATE TABLE IF NOT EXISTS public.nodo_oauth_states (
  state        text PRIMARY KEY,
  account_id   bigint NOT NULL,
  provider     text NOT NULL,
  redirect_to  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  used_at      timestamptz
);

CREATE INDEX IF NOT EXISTS nodo_oauth_states_expires_idx
  ON public.nodo_oauth_states (expires_at);

-- Las tablas nuevas nacen con grants para anon/authenticated por los
-- ALTER DEFAULT PRIVILEGES de Supabase. Esta guarda material sensible del
-- flujo de autorización, así que se revocan explícitamente: sólo la alcanzan
-- las Edge Functions vía service_role.
REVOKE ALL ON public.nodo_oauth_states FROM anon, authenticated;
