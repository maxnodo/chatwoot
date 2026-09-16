CREATE OR REPLACE FUNCTION public.nodo_protect_installation_configs()
RETURNS TRIGGER AS $$
DECLARE
  old_v TEXT := substring(COALESCE(OLD.serialized_value::text, '') from 'value: (.+?)\\n');
  new_v TEXT := substring(COALESCE(NEW.serialized_value::text, '') from 'value: (.+?)\\n');
BEGIN
  -- 1. Bloquear downgrade de pricing_plan
  IF NEW.name = 'INSTALLATION_PRICING_PLAN'
     AND old_v = 'enterprise'
     AND new_v = 'community' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado INSTALLATION_PRICING_PLAN enterprise->community (app=%, pid=%)',
      current_setting('application_name', true), pg_backend_pid();
  END IF;

  -- 2. Bloquear quantity: 10000 -> 0
  IF NEW.name = 'INSTALLATION_PRICING_PLAN_QUANTITY'
     AND old_v = '10000'
     AND new_v = '0' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado INSTALLATION_PRICING_PLAN_QUANTITY 10000->0 (app=%)',
      current_setting('application_name', true);
  END IF;

  -- 3. Bloquear reset BRAND_NAME/INSTALLATION_NAME a "Chatwoot"
  IF NEW.name IN ('BRAND_NAME','INSTALLATION_NAME')
     AND new_v = 'Chatwoot' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado % -> "Chatwoot"', NEW.name;
  END IF;

  -- 4. Bloquear URLs a chatwoot.com
  IF NEW.name IN ('BRAND_URL','WIDGET_BRAND_URL','TERMS_URL','PRIVACY_URL')
     AND new_v ~* 'chatwoot\.com' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado % -> chatwoot.com (valor propuesto: %)', NEW.name, new_v;
  END IF;

  -- 5. Bloquear LOGOs defaults
  IF NEW.name IN ('LOGO','LOGO_DARK','LOGO_THUMBNAIL')
     AND new_v ~ '^"?/brand-assets/' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado % -> logo default (%)', NEW.name, new_v;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Trigger ya existe de la v1; solo recreamos la función. Pero para seguridad:
DROP TRIGGER IF EXISTS nodo_trg_protect_installation_configs ON public.installation_configs;
CREATE TRIGGER nodo_trg_protect_installation_configs
BEFORE UPDATE ON public.installation_configs
FOR EACH ROW EXECUTE FUNCTION public.nodo_protect_installation_configs();

-- Restaurar BRAND_NAME que el test dejó roto
UPDATE public.installation_configs
SET serialized_value = to_jsonb(E'--- !ruby/hash:ActiveSupport::HashWithIndifferentAccess\nvalue: Comunidad Nodo\n'::text),
    locked = true,
    updated_at = NOW()
WHERE name = 'BRAND_NAME';
