# NODO PATCH 7: indicador de mensajes programados en la bandeja + banner en la
# conversación abierta. Reutiliza la tabla `nodo_scheduled_messages` que pobla
# tanto el Copilot (Patch 2) como las campañas Evolution (Patch 6).
#
# Endpoints:
#   GET    /api/v1/accounts/:account_id/scheduled_messages/summary
#          → Devuelve {conversation_id: {manual_count, campaign_count, total,
#                                         next_send_at, next_source}} para todas
#            las convs del account con scheduled pending. El frontend lo llama
#            una vez al cargar la bandeja y overlay sobre ConversationCard.
#
#   GET    /api/v1/accounts/:account_id/scheduled_messages?conversation_id=N
#          → Lista detallada de scheduled pending de UNA conv (para el banner
#            colapsable cuando la conv está abierta). Devuelve cada row con
#            campaign info si aplica.
#
#   DELETE /api/v1/accounts/:account_id/scheduled_messages/:id  (Patch 7.3)
#          → Cancelar un scheduled (status=cancelled). Solo del mismo account.
class Api::V1::Accounts::ScheduledMessagesController < Api::V1::Accounts::BaseController
  # NOTE: No usamos check_authorization automático porque la convención de
  # Pundit infiere el modelo desde controller_name ("ScheduledMessage") y
  # nuestro modelo se llama NodoScheduledMessage. Los GETs ya están scopeados
  # por Current.account, lo cual basta para read-only. Cancel (DELETE) sumará
  # admin check explícito en Patch 7.3.

  # GET .../scheduled_messages/summary
  # Resumen agrupado por conversation_id, optimizado para overlay en bandeja.
  # Una sola query. Devuelve solo lo necesario para el ícono + tooltip.
  def summary
    rows = NodoScheduledMessage
           .where(account_id: Current.account.id, status: 'pending')
           .where('send_at > ?', Time.current)
           .select(:conversation_id, :campaign_id, :send_at)
           .order(send_at: :asc)

    grouped = rows.group_by(&:conversation_id).transform_values do |items|
      manual = items.count { |r| r.campaign_id.nil? }
      campaign = items.count { |r| r.campaign_id.present? }
      first = items.first
      {
        manual_count: manual,
        campaign_count: campaign,
        total: items.size,
        next_send_at: first&.send_at&.iso8601,
        next_source: first&.campaign_id ? 'campaign' : 'manual'
      }
    end

    render json: grouped
  end

  # GET .../scheduled_messages?conversation_id=N
  # Lista detallada para el banner en la conversación.
  def index
    return render json: { error: 'conversation_id is required' }, status: :bad_request unless params[:conversation_id]

    conversation = Current.account.conversations.find_by(display_id: params[:conversation_id]) ||
                   Current.account.conversations.find_by(id: params[:conversation_id])
    return render json: { error: 'conversation not found' }, status: :not_found unless conversation

    @scheduled_messages = NodoScheduledMessage
                          .where(account_id: Current.account.id,
                                 conversation_id: conversation.id,
                                 status: 'pending')
                          .where('send_at > ?', Time.current)
                          .order(send_at: :asc)

    render json: @scheduled_messages.map { |sm| serialize(sm) }
  end

  private

  def serialize(scheduled_message)
    campaign = scheduled_message.campaign if scheduled_message.campaign_id
    {
      id: scheduled_message.id,
      content: scheduled_message.content,
      send_at: scheduled_message.send_at.iso8601,
      created_at: scheduled_message.created_at.iso8601,
      source: scheduled_message.campaign_id ? 'campaign' : 'manual',
      attachment_url: scheduled_message.attachment_url,
      campaign: campaign && {
        id: campaign.id,
        display_id: campaign.display_id,
        title: campaign.title
      },
      scheduled_via: scheduled_message.scheduled_via
    }
  end
end
