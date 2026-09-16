-- Configurar cron job que dispara la EF cada 1 minuto
SELECT cron.schedule(
  'dispatch-scheduled-messages',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ntncrklsckzmoaincafs.supabase.co/functions/v1/dispatch-scheduled-messages',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
