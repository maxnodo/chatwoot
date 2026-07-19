class Captain::Copilot::ChatService < Llm::BaseAiService
  include Captain::ChatHelper

  attr_reader :assistant, :account, :user, :copilot_thread, :previous_history, :messages

  def initialize(assistant, config)
    super(feature: 'copilot', account: assistant.account)

    @assistant = assistant
    @account = assistant.account
    @user = nil
    @copilot_thread = nil
    @previous_history = []
    @conversation = @account.conversations.find_by(display_id: config[:conversation_id])
    @conversation_id = @conversation&.display_id

    setup_user(config)
    setup_message_history(config)
    @tools = build_tools
    @messages = build_messages(config)
  end

  def generate_response(input)
    @messages << { role: 'user', content: input } if input.present?
    response = request_chat_completion

    Rails.logger.debug { "#{self.class.name} Assistant: #{@assistant.id}, Received response #{response}" }
    Rails.logger.info(
      "#{self.class.name} Assistant: #{@assistant.id}, Incrementing response usage for account #{@account.id}"
    )
    @account.increment_response_usage

    response
  end

  private

  def setup_user(config)
    @user = @account.users.find_by(id: config[:user_id]) if config[:user_id].present?
  end

  def build_messages(config)
    messages= [system_message]
    messages << account_id_context
    messages += @previous_history if @previous_history.present?
    messages += current_viewing_history(config[:conversation_id]) if config[:conversation_id].present?
    messages
  end

  def setup_message_history(config)
    Rails.logger.info(
      "#{self.class.name} Assistant: #{@assistant.id}, Previous History: #{config[:previous_history]&.length || 0}, Language: #{config[:language]}"
    )

    @copilot_thread = @account.copilot_threads.find_by(id: config[:copilot_thread_id]) if config[:copilot_thread_id].present?
    @previous_history = if @copilot_thread.present?
                          @copilot_thread.previous_history
                        else
                          config[:previous_history].presence || []
                        end
  end

  def build_tools
    tools = []

    tools << Captain::Tools::SearchDocumentationService.new(@assistant, user: @user)
    tools << Captain::Tools::Copilot::GetConversationService.new(@assistant, user: @user)
    tools << Captain::Tools::Copilot::SearchConversationsService.new(@assistant, user: @user)
    tools << Captain::Tools::Copilot::GetContactService.new(@assistant, user: @user)
    tools << Captain::Tools::Copilot::GetArticleService.new(@assistant, user: @user)
    tools << Captain::Tools::Copilot::SearchArticlesService.new(@assistant, user: @user)
    tools << Captain::Tools::Copilot::SearchContactsService.new(@assistant, user: @user)
    tools << Captain::Tools::Copilot::SearchLinearIssuesService.new(@assistant, user: @user)

    # NODO PATCH: exponer captain_custom_tools al Copilot.
    # Chatwoot v4.13.0 no incluye los custom_tools del account en el Copilot por defecto,
    # solo los expone al Captain Assistant. Este patch los suma tambien aca para que el
    # agente humano pueda invocarlos via chat (ej: "programa un mensaje a este contacto").
    tools += @account.captain_custom_tools.enabled.map do |custom_tool|
      custom_tool.tool(@assistant, base_class: Captain::Tools::CustomHttpTool, conversation: @conversation)
    end

    tools.select(&:active?)
  end

  def system_message
    {
      role: 'system',
      content: Captain::Llm::SystemPromptsService.copilot_response_generator(
        @assistant.config['product_name'],
        tools_summary,
        @assistant.config
      )
    }
  end

  def tools_summary
    @tools.map { |tool| "- #{tool.class.name}: #{tool.class.description}" }.join("\n")
  end

  def account_id_context
    # NODO PATCH: inyectar fecha y hora actuales en zonas UTC y Madrid.
    # El LLM no sabe la fecha actual (su training cutoff es anterior). Si no
    # se la pasamos, calcula send_at de schedule_message con anios viejos
    # (ej. 2023), lo que rompe la validacion "30s en el futuro" de la EF.
    now_utc = Time.now.utc
    now_madrid = now_utc.in_time_zone('Europe/Madrid')
    {
      role: 'system',
      content: <<~CTX.strip
        The current account id is #{@account.id}. The account is using #{@account.locale_english_name} as the language.

        CURRENT DATE AND TIME (use this as ground truth, ignore any internal training-data assumption about the year):
        - UTC now: #{now_utc.iso8601}
        - Madrid (Europe/Madrid) now: #{now_madrid.strftime('%Y-%m-%d %H:%M:%S %Z (UTC%:z)')}

        When a tool requires a timestamp (e.g. send_at in ISO 8601 UTC), derive it from THIS reference, never from your internal training cutoff. To convert Madrid wall-clock to UTC, subtract the Madrid UTC offset shown above.
      CTX
    }
  end

  def current_viewing_history(conversation_id)
    conversation = @account.conversations.find_by(display_id: conversation_id)
    return [] unless conversation

    Rails.logger.info("#{self.class.name} Assistant: #{@assistant.id}, Setting viewing history for conversation_id=#{conversation_id}")
    contact_id = conversation.contact_id
    [{
      role: 'system',
      content: <<~HISTORY.strip
        You are currently viewing the conversation with the following details:
        Conversation ID: #{conversation_id}
        Contact ID: #{contact_id}
      HISTORY
    }]
  end

  def persist_message(message, message_type = 'assistant')
    return if @copilot_thread.blank?

    @copilot_thread.copilot_messages.create!(
      message: message,
      message_type: message_type
    )
  end

  def feature_name
    'copilot'
  end
end
