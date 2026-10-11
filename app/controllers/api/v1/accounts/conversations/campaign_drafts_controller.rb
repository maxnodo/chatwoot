class Api::V1::Accounts::Conversations::CampaignDraftsController < Api::V1::Accounts::Conversations::BaseController
  before_action :ensure_admin
  before_action :campaign_draft

  def approve
    send_at = Time.zone.parse(params[:send_at].to_s)
    return render json: { error: 'La fecha de envío es obligatoria.' }, status: :bad_request if send_at.blank?
    return render json: { error: 'El envío debe programarse al menos 30 segundos en el futuro.' }, status: :unprocessable_entity if send_at <= 30.seconds.from_now
    return render json: { error: 'El envío debe ser dentro de los próximos 30 días.' }, status: :unprocessable_entity if send_at > 30.days.from_now

    scheduled = nil
    @campaign_draft.with_lock do
      ensure_pending!
      scheduled = NodoScheduledMessage.create!(
        account_id: Current.account.id,
        inbox_id: @conversation.inbox_id,
        conversation_id: @conversation.id,
        conversation_display_id: @conversation.display_id,
        content: @campaign_draft.content,
        send_at: send_at,
        status: 'pending',
        scheduled_by_user_id: Current.user.id,
        scheduled_via: 'campaign_review_ui',
        metadata: { campaign_draft_id: @campaign_draft.id, review_status: 'approved' }
      )
      @campaign_draft.update!(status: 'scheduled', approved_by_user_id: Current.user.id, approved_at: Time.current)
      update_review_message_status('scheduled')
    end

    render json: { draft_id: @campaign_draft.id, status: 'scheduled', scheduled_id: scheduled.id, send_at: scheduled.send_at.iso8601 }
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def reject
    @campaign_draft.with_lock do
      ensure_pending!
      @campaign_draft.update!(status: 'rejected', approved_by_user_id: Current.user.id, approved_at: Time.current)
      update_review_message_status('rejected')
    end
    render json: { draft_id: @campaign_draft.id, status: 'rejected' }
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def regenerate
    assistant = campaign_assistant
    content = Nodo::CampaignDraftGeneratorService.new(
      assistant: assistant, conversation: @conversation, objective: @campaign_draft.objective
    ).perform

    replacement = nil
    message = nil
    ActiveRecord::Base.transaction do
      @campaign_draft.lock!
      ensure_pending!
      replacement = NodoMessageCampaignDraft.create!(
        account_id: Current.account.id, inbox_id: @conversation.inbox_id, conversation_id: @conversation.id,
        recurring_message_id: @campaign_draft.recurring_message_id, objective: @campaign_draft.objective,
        content: content, proposed_for: @campaign_draft.proposed_for
      )
      @campaign_draft.update!(status: 'rejected', approved_by_user_id: Current.user.id, approved_at: Time.current)
      update_review_message_status('rejected')
      message = Message.create!(
        account: Current.account, inbox: @conversation.inbox, conversation: @conversation, sender: assistant,
        message_type: :outgoing, private: true,
        additional_attributes: { nodo_campaign_draft_id: replacement.id, nodo_campaign_draft_status: 'pending_review' },
        content: "📝 Borrador DRAFT-#{replacement.id} pendiente de revisión:\n\n#{content}\n\nNo se enviará hasta que el equipo lo apruebe."
      )
      notify_account_administrators(message)
    end
    render json: { draft_id: replacement.id, status: 'pending_review', message_id: message.id }
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  private

  def ensure_admin
    raise Pundit::NotAuthorizedError unless Current.account_user&.administrator?
  end

  def campaign_draft
    @conversation = Current.account.conversations.find_by!(display_id: params[:conversation_id])
    @campaign_draft = NodoMessageCampaignDraft.find_by!(id: params[:id], account_id: Current.account.id, conversation_id: @conversation.id)
  end

  def ensure_pending!
    raise ActiveRecord::RecordInvalid, @campaign_draft unless @campaign_draft.status == 'pending_review'
  end

  def update_review_message_status(status)
    value = ActiveRecord::Base.connection.quote({ nodo_campaign_draft_status: status }.to_json)
    Message.where(conversation_id: @conversation.id)
           .where("additional_attributes ->> 'nodo_campaign_draft_id' = ?", @campaign_draft.id.to_s)
           .update_all("additional_attributes = COALESCE(additional_attributes, '{}'::jsonb) || #{value}::jsonb")
  end

  def campaign_assistant
    assistant_id = @campaign_draft.recurring_message_id && ActiveRecord::Base.connection.select_value(
      "SELECT campaign_assistant_id FROM nodo_weekly_recurring_messages WHERE id = #{@campaign_draft.recurring_message_id.to_i}"
    )
    Captain::Assistant.find_by!(account_id: Current.account.id, id: assistant_id || (Current.account.id == 25 ? 7 : 8))
  end

  def notify_account_administrators(message)
    AccountUser.where(account_id: Current.account.id, role: :administrator).includes(:user).find_each do |account_user|
      NotificationBuilder.new(
        notification_type: 'participating_conversation_new_message', user: account_user.user,
        account: Current.account, primary_actor: @conversation, secondary_actor: message
      ).perform
    end
  end
end
