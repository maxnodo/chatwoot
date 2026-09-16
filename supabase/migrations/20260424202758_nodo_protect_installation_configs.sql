CREATE OR REPLACE FUNCTION public.nodo_protect_installation_configs()
RETURNS TRIGGER AS $$
DECLARE
  old_str TEXT := COALESCE(OLD.serialized_value::text, '');
  new_str TEXT := COALESCE(NEW.serialized_value::text, '');
BEGIN
  -- 1. Bloquear downgrade de pricing_plan: enterprise -> community
  IF NEW.name = 'INSTALLATION_PRICING_PLAN'
     AND old_str ~* 'enterprise'
     AND new_str ~* 'community' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado intento de downgrade INSTALLATION_PRICING_PLAN enterprise->community (backend_pid=%, app=%)',
      pg_backend_pid(), current_setting('application_name', true);
  END IF;

  -- 2. Bloquear downgrade de quantity: 10000 -> 0
  IF NEW.name = 'INSTALLATION_PRICING_PLAN_QUANTITY'
     AND old_str ~ 'value: 10000'
     AND new_str ~ 'value: 0\s*$' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado intento de resetear INSTALLATION_PRICING_PLAN_QUANTITY a 0 (app=%)',
      current_setting('application_name', true);
  END IF;

  -- 3. Bloquear reset de branding a "Chatwoot"
  IF NEW.name IN ('BRAND_NAME','INSTALLATION_NAME')
     AND new_str ~ 'value: Chatwoot\s*$'
     AND old_str ~* 'Comunidad Nodo' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado intento de resetear % a "Chatwoot"', NEW.name;
  END IF;

  -- 4. Bloquear reset de URLs a chatwoot.com
  IF NEW.name IN ('BRAND_URL','WIDGET_BRAND_URL','TERMS_URL','PRIVACY_URL')
     AND new_str ~* 'https://www\.chatwoot\.com'
     AND old_str ~* 'otronodo\.com' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado intento de resetear % a chatwoot.com', NEW.name;
  END IF;

  -- 5. Bloquear reset de LOGOs a /brand-assets defaults
  IF NEW.name IN ('LOGO','LOGO_DARK','LOGO_THUMBNAIL')
     AND new_str ~ '/brand-assets/'
     AND old_str !~ '/brand-assets/' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado intento de resetear % a logo default de Chatwoot', NEW.name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS nodo_trg_protect_installation_configs ON public.installation_configs;

CREATE TRIGGER nodo_trg_protect_installation_configs
BEFORE UPDATE ON public.installation_configs
FOR EACH ROW EXECUTE FUNCTION public.nodo_protect_installation_configs();

COMMENT ON FUNCTION public.nodo_protect_installation_configs IS
'Bloquea UPDATEs que intenten resetear Enterprise/branding de Comunidad Nodo a defaults de Chatwoot. Creado 2026-04-24 para contrarrestar job Sidekiq de reset diario 17:07 UTC. Drop con: DROP TRIGGER nodo_trg_protect_installation_configs ON public.installation_configs; DROP FUNCTION public.nodo_protect_installation_configs();';
