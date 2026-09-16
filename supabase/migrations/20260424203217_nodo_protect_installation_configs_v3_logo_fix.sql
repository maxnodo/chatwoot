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
     AND new_v ILIKE '%chatwoot.com%' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado % -> chatwoot.com', NEW.name;
  END IF;

  -- 5. Bloquear LOGOs defaults (cubre "/brand-assets/..." con o sin escape)
  IF NEW.name IN ('LOGO','LOGO_DARK','LOGO_THUMBNAIL')
     AND new_v ILIKE '%brand-assets%'
     AND new_v NOT ILIKE '%supabase%' THEN
    RAISE EXCEPTION 'nodo_protect: rechazado % -> logo default', NEW.name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Restaurar LOGO que el test anterior dejó roto
UPDATE public.installation_configs
SET serialized_value = to_jsonb(E'--- !ruby/hash:ActiveSupport::HashWithIndifferentAccess\nvalue: https://azmurvcoiqbktxmevsga.supabase.co/storage/v1/object/public/imagenes-whatsapp/ChatGPT-Image-29-jun-2025-01_18_40.png\n'::text),
    locked = true,
    updated_at = NOW()
WHERE name = 'LOGO';
