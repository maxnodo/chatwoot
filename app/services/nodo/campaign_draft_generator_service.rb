class Nodo::CampaignDraftGeneratorService
  MAX_LENGTH = 1_000

  def initialize(assistant:, conversation:, objective:)
    @assistant = assistant
    @conversation = conversation
    @objective = objective.to_s.squish
  end

  def perform
    result = Agents::Runner.with_agents(generator_agent).run(
      prompt,
      context: {
        session_id: "nodo-campaign-#{@conversation.account_id}-#{@conversation.display_id}",
        state: { timezone: 'Europe/Madrid', message_length_limit: MAX_LENGTH }
      }
    )

    content = Captain::Assistant::ResponseParts.from_response(result.output).plain_text.squish
    raise 'Campaign draft generator returned an empty message' if content.blank?

    content.first(MAX_LENGTH)
  end

  private

  def generator_agent
    @assistant.agent.clone(instructions: ->(_context) { prompt }, tools: [])
  end

  def prompt
    <<~PROMPT
      Genera SOLO un mensaje listo para enviar en español. No expliques tu respuesta,
      no uses herramientas, no programes ni envíes nada. El mensaje debe ser breve,
      natural y diferente de los mensajes recientes.

      Objetivo: #{@objective}
      Conversación: #{@conversation.display_id}
      Mensajes salientes recientes: #{recent_messages.presence || 'ninguno'}
    PROMPT
  end

  def recent_messages
    @conversation.messages
                 .where(message_type: :outgoing, private: false)
                 .reorder(created_at: :desc)
                 .limit(8)
                 .pluck(:content)
                 .compact
                 .map(&:squish)
                 .reject(&:blank?)
                 .join(' | ')
                 .first(3_000)
  end
end
