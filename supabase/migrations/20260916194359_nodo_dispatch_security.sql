-- Authenticate cron without embedding credentials in Git or cron.job.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'nodo_dispatch_token') THEN
    PERFORM vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'nodo_dispatch_token', 'Internal Nodo dispatch authentication');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.nodo_dispatch_authorized(provided_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(length(provided_token) > 0 AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'nodo_dispatch_token'
      AND sha256(convert_to(decrypted_secret, 'UTF8')) = sha256(convert_to(provided_token, 'UTF8'))
  ), false);
$$;
REVOKE ALL ON FUNCTION public.nodo_dispatch_authorized(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nodo_dispatch_authorized(text) TO service_role;

ALTER TABLE public.nodo_scheduled_messages DROP CONSTRAINT nodo_scheduled_messages_status_check;
ALTER TABLE public.nodo_scheduled_messages ADD CONSTRAINT nodo_scheduled_messages_status_check
CHECK (status IN ('pending','processing','sent','failed','cancelled'));

DO $$
DECLARE job record;
BEGIN
  FOR job IN SELECT jobid, jobname FROM cron.job
    WHERE jobname IN ('dispatch-scheduled-messages','dispatch-group-messages')
  LOOP
    PERFORM cron.alter_job(job.jobid, command := format($command$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-nodo-dispatch-token',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='nodo_dispatch_token')),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $command$, 'https://ntncrklsckzmoaincafs.supabase.co/functions/v1/' || job.jobname));
  END LOOP;
END $$;
