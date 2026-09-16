-- Tabla de audit propia para trackear quien modifica installation_configs.
-- NOT Chatwoot's table — es nuestra, en schema public pero con prefijo para
-- evitar colisiones con migraciones futuras de Chatwoot.
CREATE TABLE IF NOT EXISTS public.nodo_installation_config_audit (
  id BIGSERIAL PRIMARY KEY,
  config_id BIGINT,
  config_name TEXT NOT NULL,
  operation TEXT NOT NULL,  -- 'UPDATE' | 'INSERT' | 'DELETE'
  old_value JSONB,
  new_value JSONB,
  old_locked BOOLEAN,
  new_locked BOOLEAN,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  pg_user TEXT DEFAULT current_user,
  pg_session_user TEXT DEFAULT session_user,
  pg_backend_pid INT DEFAULT pg_backend_pid(),
  pg_application_name TEXT DEFAULT current_setting('application_name', true),
  pg_client_addr INET DEFAULT inet_client_addr(),
  pg_client_port INT DEFAULT inet_client_port()
);

CREATE INDEX IF NOT EXISTS idx_nicc_changed_at
  ON public.nodo_installation_config_audit (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nicc_config_name
  ON public.nodo_installation_config_audit (config_name, changed_at DESC);

CREATE OR REPLACE FUNCTION public.nodo_log_installation_config_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.serialized_value IS DISTINCT FROM NEW.serialized_value
       OR OLD.locked IS DISTINCT FROM NEW.locked THEN
      INSERT INTO public.nodo_installation_config_audit
        (config_id, config_name, operation, old_value, new_value, old_locked, new_locked)
      VALUES (NEW.id, NEW.name, 'UPDATE', OLD.serialized_value, NEW.serialized_value, OLD.locked, NEW.locked);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.nodo_installation_config_audit
      (config_id, config_name, operation, new_value, new_locked)
    VALUES (NEW.id, NEW.name, 'INSERT', NEW.serialized_value, NEW.locked);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.nodo_installation_config_audit
      (config_id, config_name, operation, old_value, old_locked)
    VALUES (OLD.id, OLD.name, 'DELETE', OLD.serialized_value, OLD.locked);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS nodo_trg_installation_config_audit ON public.installation_configs;
CREATE TRIGGER nodo_trg_installation_config_audit
AFTER INSERT OR UPDATE OR DELETE ON public.installation_configs
FOR EACH ROW EXECUTE FUNCTION public.nodo_log_installation_config_changes();

COMMENT ON TABLE public.nodo_installation_config_audit IS
'Audit trail propio de cambios a installation_configs. Creado para debuggear reset diario 17:07 UTC. Safe to drop cuando se identifique la causa.';
