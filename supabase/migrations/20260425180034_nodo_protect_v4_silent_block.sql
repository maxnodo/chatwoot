CREATE OR REPLACE FUNCTION public.nodo_protect_installation_configs()
RETURNS TRIGGER AS $$
DECLARE
  old_v TEXT := substring(COALESCE(OLD.serialized_value::text, '') from 'value: (.+?)\\n');
  new_v TEXT := substring(COALESCE(NEW.serialized_value::text, '') from 'value: (.+?)\\n');
  v_blocked TEXT := NULL;
BEGIN
  -- 1. Bloquear downgrade de pricing_plan
  IF NEW.name = 'INSTALLATION_PRICING_PLAN'
     AND old_v = 'enterprise'
     AND new_v = 'community' THEN
    v_blocked := 'pricing_plan enterprise->community';

  -- 2. Bloquear quantity 10000 -> 0
  ELSIF NEW.name = 'INSTALLATION_PRICING_PLAN_QUANTITY'
        AND old_v = '10000'
        AND new_v = '0' THEN
    v_blocked := 'quantity 10000->0';

  -- 3. Bloquear BRAND_NAME / INSTALLATION_NAME a "Chatwoot"
  ELSIF NEW.name IN ('BRAND_NAME','INSTALLATION_NAME')
        AND new_v = 'Chatwoot' THEN
    v_blocked := NEW.name || ' -> Chatwoot';

  -- 4. Bloquear URLs a chatwoot.com
  ELSIF NEW.name IN ('BRAND_URL','WIDGET_BRAND_URL','TERMS_URL','PRIVACY_URL')
        AND new_v ILIKE '%chatwoot.com%' THEN
    v_blocked := NEW.name || ' -> chatwoot.com';

  -- 5. Bloquear LOGOs default
  ELSIF NEW.name IN ('LOGO','LOGO_DARK','LOGO_THUMBNAIL')
        AND new_v ILIKE '%brand-assets%'
        AND new_v NOT ILIKE '%supabase%' THEN
    v_blocked := NEW.name || ' -> logo default';
  END IF;

  IF v_blocked IS NOT NULL THEN
    -- Registrar el intento bloqueado en audit (con operation BLOCKED)
    INSERT INTO public.nodo_installation_config_audit (
      config_id, config_name, operation,
      old_value, new_value, old_locked, new_locked,
      pg_application_name, pg_client_addr, pg_backend_pid
    ) VALUES (
      NEW.id, NEW.name, 'BLOCKED',
      OLD.serialized_value, NEW.serialized_value, OLD.locked, NEW.locked,
      current_setting('application_name', true),
      inet_client_addr(), pg_backend_pid()
    );
    -- Cancelar el UPDATE silenciosamente (sin RAISE)
    -- Sidekiq cree que el UPDATE fue exitoso y NO genera retry/dead job
    RETURN NULL;
  END IF;

  -- UPDATE legitimo: continuar normalmente
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.nodo_protect_installation_configs IS
'v4 (silent block): registra intentos en nodo_installation_config_audit con operation=BLOCKED y devuelve NULL para cancelar el UPDATE sin generar excepcion. El job de Sidekiq cree que el UPDATE fue exitoso → no se acumulan dead jobs.';
