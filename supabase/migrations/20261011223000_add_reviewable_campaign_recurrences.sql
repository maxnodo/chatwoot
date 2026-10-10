ALTER TABLE public.nodo_weekly_recurring_messages
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'send'
    CHECK (delivery_mode IN ('send', 'draft_review')),
  ADD COLUMN IF NOT EXISTS campaign_objective text,
  ADD COLUMN IF NOT EXISTS campaign_assistant_id bigint REFERENCES public.captain_assistants(id) ON DELETE SET NULL;

ALTER TABLE public.nodo_weekly_recurring_messages
  ADD CONSTRAINT nodo_campaign_recurrence_configuration
  CHECK (
    (delivery_mode = 'send' AND campaign_objective IS NULL AND campaign_assistant_id IS NULL)
    OR
    (delivery_mode = 'draft_review' AND char_length(trim(campaign_objective)) BETWEEN 1 AND 1000 AND campaign_assistant_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.nodo_weekly_recurring_messages
  VALIDATE CONSTRAINT nodo_campaign_recurrence_configuration;

CREATE OR REPLACE FUNCTION public.nodo_create_campaign_recurring_message(
  p_account_id bigint,
  p_conversation_display_id bigint,
  p_objective text,
  p_weekday integer,
  p_local_time time without time zone,
  p_assistant_id bigint,
  p_timezone text DEFAULT 'Europe/Madrid',
  p_user_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  conv public.conversations%ROWTYPE;
  created public.nodo_weekly_recurring_messages%ROWTYPE;
BEGIN
  IF p_account_id NOT IN (1, 25) THEN RAISE EXCEPTION 'account not authorized'; END IF;
  IF char_length(trim(p_objective)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'objective must contain between 1 and 1000 characters'; END IF;
  IF p_weekday NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'weekday must be between 0 and 6'; END IF;
  IF p_timezone <> 'Europe/Madrid' THEN RAISE EXCEPTION 'unsupported timezone'; END IF;

  SELECT * INTO conv FROM public.conversations
  WHERE account_id = p_account_id AND display_id = p_conversation_display_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inboxes WHERE id = conv.inbox_id AND channel_type = 'Channel::Api') THEN
    RAISE EXCEPTION 'campaign recurrences require a Channel::Api inbox';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.captain_assistants WHERE id = p_assistant_id AND account_id = p_account_id) THEN
    RAISE EXCEPTION 'assistant not found';
  END IF;

  INSERT INTO public.nodo_weekly_recurring_messages (
    account_id, inbox_id, conversation_id, conversation_display_id, content,
    weekday, local_time, timezone, next_run_at, created_by_user_id,
    delivery_mode, campaign_objective, campaign_assistant_id
  ) VALUES (
    p_account_id, conv.inbox_id, conv.id, conv.display_id, '[Borrador de campaña pendiente de revisión]',
    p_weekday, p_local_time, p_timezone,
    public.nodo_next_weekly_occurrence(p_weekday, p_local_time, p_timezone, now()), p_user_id,
    'draft_review', trim(p_objective), p_assistant_id
  ) RETURNING * INTO created;

  RETURN to_jsonb(created);
END;
$$;

CREATE OR REPLACE FUNCTION public.nodo_materialize_weekly_recurring_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  recurring public.nodo_weekly_recurring_messages%ROWTYPE;
  materialized integer := 0;
BEGIN
  FOR recurring IN
    SELECT * FROM public.nodo_weekly_recurring_messages
    WHERE status = 'active' AND delivery_mode = 'send' AND next_run_at <= now()
    ORDER BY next_run_at FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.nodo_scheduled_messages (
      account_id, inbox_id, conversation_id, conversation_display_id,
      content, send_at, status, scheduled_by_user_id, scheduled_via, metadata,
      created_at, updated_at
    ) VALUES (
      recurring.account_id, recurring.inbox_id, recurring.conversation_id,
      recurring.conversation_display_id, recurring.content, recurring.next_run_at,
      'pending', recurring.created_by_user_id, 'recurring',
      jsonb_build_object('recurring_id', recurring.id, 'timezone', recurring.timezone,
        'weekday', recurring.weekday, 'local_time', to_char(recurring.local_time, 'HH24:MI')),
      now(), now()
    ) ON CONFLICT DO NOTHING;

    UPDATE public.nodo_weekly_recurring_messages
    SET last_materialized_at = recurring.next_run_at,
        next_run_at = public.nodo_next_weekly_occurrence(recurring.weekday, recurring.local_time, recurring.timezone, recurring.next_run_at + interval '1 second'),
        updated_at = now()
    WHERE id = recurring.id;
    materialized := materialized + 1;
  END LOOP;
  RETURN materialized;
END;
$$;

REVOKE ALL ON FUNCTION public.nodo_create_campaign_recurring_message(bigint,bigint,text,integer,time without time zone,bigint,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nodo_create_campaign_recurring_message(bigint,bigint,text,integer,time without time zone,bigint,text,bigint) TO service_role;
