# NODO PATCH 6: endpoint que devuelve el estado de la quota de campañas
# Channel::Api (Evolution) para un inbox dado. El frontend lo usa para
# mostrar "te quedan X mensajes en las próximas Y horas" en el dialog
# de creación de campaign, y para deshabilitar el botón "Nueva campaña"
# si ya hay una campaign activa en ese inbox.
#
# GET /api/v1/accounts/:account_id/inboxes/:inbox_id/api_campaign_quota
#
# Response:
#   {
#     "feature_enabled": true,
#     "inbox_type_supported": true,
#     "daily_cap": 200,
#     "rolling_window_hours": 24,
#     "slots_used": 120,
#     "slots_available": 80,
#     "next_slot_available_at": "2026-05-16T18:30:00Z" | null,
#     "active_campaign": {
#       "id": 42,
#       "title": "Promo mayo",
#       "pending_count": 23
#     } | null
#   }
#
# Si `feature_enabled` es false → el frontend oculta el botón "Nueva campaña".
# Si `inbox_type_supported` es false → el inbox no es Channel::Api.
# Si `active_campaign` no es null → hay una campaña en curso, el frontend
# deshabilita "Nueva campaña" hasta que termine.

class Api::V1::Accounts::Inboxes::ApiCampaignQuotasController < Api::V1::Accounts::BaseController
  DAILY_CAP_PER_INBOX = ::Api::OneoffCampaignService::DAILY_CAP_PER_INBOX
  ROLLING_WINDOW_HOURS = ::Api::OneoffCampaignService::ROLLING_WINDOW_HOURS

  before_action :fetch_inbox

  def show
    render json: build_response
  end

  private

  def fetch_inbox
    @inbox = Current.account.inboxes.find(params[:inbox_id])
  end

  def build_response
    {
      feature_enabled: Current.account.feature_enabled?(:api_campaign),
      inbox_type_supported: @inbox.inbox_type == 'API',
      daily_cap: DAILY_CAP_PER_INBOX,
      rolling_window_hours: ROLLING_WINDOW_HOURS,
      slots_used: slots_used,
      slots_available: [DAILY_CAP_PER_INBOX - slots_used, 0].max,
      next_slot_available_at: next_slot_available_at,
      active_campaign: active_campaign_summary
    }
  end

  def slots_used
    @slots_used ||= NodoScheduledMessage.in_rolling_window(@inbox.id, ROLLING_WINDOW_HOURS).count
  end

  # Si los slots están agotados (>=200), devuelve el momento en que se libera
  # el primer slot (= cuando el mensaje más antiguo de la ventana sale de la
  # ventana, es decir, su created_at + 24h).
  def next_slot_available_at
    return nil if slots_used < DAILY_CAP_PER_INBOX

    oldest_in_window = NodoScheduledMessage.in_rolling_window(@inbox.id, ROLLING_WINDOW_HOURS)
                                            .order(created_at: :asc)
                                            .limit(1)
                                            .pluck(:created_at)
                                            .first
    return nil unless oldest_in_window

    (oldest_in_window + ROLLING_WINDOW_HOURS.hours).iso8601
  end

  def active_campaign_summary
    # 1) Campaign sin procesar todavia (active + one_off + no completed)
    active = Current.account.campaigns
                    .where(inbox_id: @inbox.id, campaign_status: :active, campaign_type: :one_off)
                    .first
    return summarize(active) if active

    # 2) Campaign procesada pero con scheduled_messages pendientes (dispatch en curso)
    pending_smsgs = NodoScheduledMessage.where(inbox_id: @inbox.id, status: 'pending').where.not(campaign_id: nil)
    pending_campaign_id = pending_smsgs.distinct.pluck(:campaign_id).first
    return nil unless pending_campaign_id

    campaign = Current.account.campaigns.find_by(id: pending_campaign_id)
    return nil unless campaign

    summarize(campaign, pending_count_override: pending_smsgs.where(campaign_id: pending_campaign_id).count)
  end

  def summarize(campaign, pending_count_override: nil)
    pending_count = pending_count_override ||
                    NodoScheduledMessage.where(campaign_id: campaign.id, status: 'pending').count
    {
      id: campaign.id,
      title: campaign.title,
      pending_count: pending_count,
      # NODO PATCH 12: el form muestra "programada para las HH:MM" cuando la
      # campaña activa todavía no empezó a despachar.
      scheduled_at: campaign.scheduled_at&.iso8601
    }
  end
end
