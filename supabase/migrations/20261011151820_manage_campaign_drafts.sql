CREATE OR REPLACE FUNCTION public.nodo_approve_campaign_draft(
  p_account_id bigint,
  p_conversation_display_id bigint,
  p_draft_id bigint,
  p_send_at timestamptz,
  p_user_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  draft public.nodo_message_campaign_drafts%ROWTYPE;
  conv public.conversations%ROWTYPE;
  scheduled public.nodo_scheduled_messages%ROWTYPE;
BEGIN
  IF p_account_id NOT IN (1, 25) THEN RAISE EXCEPTION 'account not authorized'; END IF;
  IF p_send_at <= now() + interval '30 seconds' OR p_send_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'send_at must be between 30 seconds and 30 days in the future';
  END IF;

  SELECT d.* INTO draft
  FROM public.nodo_message_campaign_drafts d
  JOIN public.conversations c ON c.id = d.conversation_id
  WHERE d.id = p_draft_id
    AND d.account_id = p_account_id
    AND c.display_id = p_conversation_display_id
  FOR UPDATE OF d;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign draft not found'; END IF;
  IF draft.status <> 'pending_review' THEN RAISE EXCEPTION 'campaign draft is no longer pending review'; END IF;

  SELECT * INTO conv FROM public.conversations WHERE id = draft.conversation_id;
  IF NOT EXISTS (SELECT 1 FROM public.inboxes WHERE id = conv.inbox_id AND channel_type = 'Channel::Api') THEN
    RAISE EXCEPTION 'campaign drafts require a Channel::Api inbox';
  END IF;

  INSERT INTO public.nodo_scheduled_messages (
    account_id, inbox_id, conversation_id, conversation_display_id,
    content, send_at, status, scheduled_by_user_id, scheduled_via, metadata,
    created_at, updated_at
  ) VALUES (
    draft.account_id, draft.inbox_id, draft.conversation_id, conv.display_id,
    draft.content, p_send_at, 'pending', p_user_id, 'campaign_review',
    jsonb_build_object('campaign_draft_id', draft.id, 'review_status', 'approved'),
    now(), now()
  ) RETURNING * INTO scheduled;

  UPDATE public.nodo_message_campaign_drafts
  SET status = 'scheduled', approved_by_user_id = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = draft.id;

  RETURN jsonb_build_object('draft_id', draft.id, 'scheduled_id', scheduled.id, 'send_at', scheduled.send_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.nodo_reject_campaign_draft(
  p_account_id bigint,
  p_conversation_display_id bigint,
  p_draft_id bigint,
  p_user_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  draft public.nodo_message_campaign_drafts%ROWTYPE;
BEGIN
  IF p_account_id NOT IN (1, 25) THEN RAISE EXCEPTION 'account not authorized'; END IF;

  SELECT d.* INTO draft
  FROM public.nodo_message_campaign_drafts d
  JOIN public.conversations c ON c.id = d.conversation_id
  WHERE d.id = p_draft_id
    AND d.account_id = p_account_id
    AND c.display_id = p_conversation_display_id
  FOR UPDATE OF d;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign draft not found'; END IF;
  IF draft.status <> 'pending_review' THEN RAISE EXCEPTION 'campaign draft is no longer pending review'; END IF;

  UPDATE public.nodo_message_campaign_drafts
  SET status = 'rejected', approved_by_user_id = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = draft.id;

  RETURN jsonb_build_object('draft_id', draft.id, 'status', 'rejected');
END;
$$;

REVOKE ALL ON FUNCTION public.nodo_approve_campaign_draft(bigint,bigint,bigint,timestamptz,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nodo_reject_campaign_draft(bigint,bigint,bigint,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nodo_approve_campaign_draft(bigint,bigint,bigint,timestamptz,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.nodo_reject_campaign_draft(bigint,bigint,bigint,bigint) TO service_role;
