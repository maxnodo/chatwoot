-- The output parameter schedule_id shadowed the conflict target column in
-- nodo_claim_due_coc_news_runs. Refer to the named unique constraint instead.
CREATE OR REPLACE FUNCTION public.nodo_claim_due_coc_news_runs()
RETURNS TABLE(run_id uuid, schedule_id bigint, account_id bigint, assistant_id bigint, inbox_id bigint, conversation_id bigint, conversation_display_id bigint, topic text, lookback_days text, scheduled_for timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  schedule_row public.nodo_coc_recurring_news_schedules%ROWTYPE;
  new_run public.nodo_coc_recurring_news_runs%ROWTYPE;
BEGIN
  FOR schedule_row IN
    SELECT * FROM public.nodo_coc_recurring_news_schedules
    WHERE status = 'active' AND next_run_at <= now()
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.nodo_coc_recurring_news_runs (schedule_id, scheduled_for, status)
    VALUES (schedule_row.id, schedule_row.next_run_at, 'preparing')
    ON CONFLICT ON CONSTRAINT nodo_coc_recurring_news_runs_schedule_id_scheduled_for_key DO NOTHING
    RETURNING * INTO new_run;

    UPDATE public.nodo_coc_recurring_news_schedules
    SET next_run_at = public.nodo_next_coc_news_run(frequency, weekday, local_time, schedule_row.next_run_at + interval '1 second'),
        updated_at = now()
    WHERE id = schedule_row.id;

    IF new_run.id IS NOT NULL THEN
      INSERT INTO public.nodo_coc_recurring_news_events (schedule_id, run_id, event_type, payload)
      VALUES (schedule_row.id, new_run.id, 'prepared', jsonb_build_object('scheduled_for', new_run.scheduled_for));
      run_id := new_run.id;
      schedule_id := schedule_row.id;
      account_id := schedule_row.account_id;
      assistant_id := schedule_row.assistant_id;
      inbox_id := schedule_row.inbox_id;
      conversation_id := schedule_row.conversation_id;
      conversation_display_id := schedule_row.conversation_display_id;
      topic := schedule_row.topic;
      lookback_days := schedule_row.lookback_days;
      scheduled_for := new_run.scheduled_for;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;
