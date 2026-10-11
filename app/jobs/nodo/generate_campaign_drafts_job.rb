class Nodo::GenerateCampaignDraftsJob < ApplicationJob
  queue_as :scheduled_jobs

  def perform
    due_campaigns.each { |campaign| generate_draft(campaign) }
  end

  private

  def due_campaigns
    ActiveRecord::Base.connection.select_all(<<~SQL.squish)
      SELECT * FROM nodo_weekly_recurring_messages
      WHERE status = 'active' AND delivery_mode = 'draft_review' AND next_run_at <= now()
      ORDER BY next_run_at FOR UPDATE SKIP LOCKED
    SQL
  end

  def generate_draft(campaign)
    ActiveRecord::Base.transaction do
      locked = ActiveRecord::Base.connection.select_one(<<~SQL.squish)
        SELECT * FROM nodo_weekly_recurring_messages
        WHERE id = #{connection.quote(campaign['id'])}
          AND status = 'active' AND delivery_mode = 'draft_review' AND next_run_at <= now()
        FOR UPDATE SKIP LOCKED
      SQL
      return unless locked

      conversation = Conversation.find_by!(id: locked['conversation_id'], account_id: locked['account_id'])
      assistant = Captain::Assistant.find_by!(id: locked['campaign_assistant_id'], account_id: locked['account_id'])
      content = Nodo::CampaignDraftGeneratorService.new(
        assistant: assistant,
        conversation: conversation,
        objective: locked['campaign_objective']
      ).perform

      draft_id = connection.select_value(<<~SQL.squish)
        INSERT INTO nodo_message_campaign_drafts
          (account_id, inbox_id, conversation_id, recurring_message_id, objective, content, status, proposed_for, created_at, updated_at)
        VALUES
          (#{connection.quote(locked['account_id'])}, #{connection.quote(locked['inbox_id'])}, #{connection.quote(locked['conversation_id'])}, #{connection.quote(locked['id'])}, #{connection.quote(locked['campaign_objective'])}, #{connection.quote(content)}, 'pending_review', #{connection.quote(locked['next_run_at'])}, now(), now())
        RETURNING id
      SQL
      review_message = Message.create!(
        account: conversation.account,
        inbox: conversation.inbox,
        conversation: conversation,
        sender: assistant,
        message_type: :outgoing,
        private: true,
        content: "📝 Borrador DRAFT-#{draft_id} pendiente de revisión:\n\n#{content}\n\nNo se enviará hasta que el equipo lo apruebe."
      )
      notify_account_administrators(conversation, review_message)
      connection.execute(<<~SQL.squish)
        UPDATE nodo_weekly_recurring_messages
        SET last_materialized_at = next_run_at,
            next_run_at = nodo_next_weekly_occurrence(weekday, local_time, timezone, next_run_at + interval '1 second'),
            updated_at = now()
        WHERE id = #{connection.quote(locked['id'])}
      SQL
    end
  rescue StandardError => e
    Rails.logger.error("[Nodo campaign drafts] recurring_id=#{campaign['id']} failed: #{e.message}")
    raise
  end

  def connection
    ActiveRecord::Base.connection
  end

  # A campaign draft is an internal task. Alert administrators who can access
  # the conversation so they can review it from the web or mobile app.
  def notify_account_administrators(conversation, message)
    AccountUser.where(account_id: conversation.account_id, role: :administrator).includes(:user).find_each do |account_user|
      NotificationBuilder.new(
        notification_type: 'participating_conversation_new_message',
        user: account_user.user,
        account: conversation.account,
        primary_actor: conversation,
        secondary_actor: message
      ).perform
    end
  end
end
