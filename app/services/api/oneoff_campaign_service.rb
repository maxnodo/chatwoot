# NODO PATCH 6: campañas one-off para Channel::Api (Evolution).
#
# A diferencia de Whatsapp::OneoffCampaignService que manda los mensajes
# sincrónicamente (uno por uno con throttling implícito), este service
# CREA N rows en la tabla `nodo_scheduled_messages` y deja que el cron
# EF `dispatch-scheduled-messages` los despache después. Beneficios:
#   - El job de Sidekiq termina rápido (solo INSERTs en DB).
#   - Throttling y delay aleatorio quedan implementados via send_at.
#   - Si hay 250+ contactos, los excedentes se programan para el siguiente
#     rolling window de 24h (spread automático).
#   - Permite cancelar la campaign sin matar un job en curso (basta marcar
#     los nodo_scheduled_messages.status = 'cancelled').
#
# Reglas (definidas en sesion del 15/05/2026):
#   - Cap: 200 mensajes / rolling window de 24h, por inbox
#   - Delay entre mensajes: aleatorio entre 3 y 20 segundos
#   - Si la audiencia excede 200: spread automatico (200 hoy, resto manana)
#   - Exclusion mutua: solo 1 campaign Evolution activa por inbox a la vez
#     (validado en Campaign#validate_api_campaign_exclusivity)
#   - Soporte de imagen opcional via URL publica (`campaign.template_params['attachment_url']`)

class Api::OneoffCampaignService
  pattr_initialize [:campaign!]

  ROLLING_WINDOW_HOURS = 24
  DAILY_CAP_PER_INBOX = 200
  MIN_DELAY_SECONDS = 3
  MAX_DELAY_SECONDS = 20

  def perform
    validate_campaign!

    contacts = fetch_audience
    Rails.logger.info "[ApiCampaign #{campaign.id}] Audience: #{contacts.count} contacts"

    if contacts.empty?
      campaign.completed!
      Rails.logger.warn "[ApiCampaign #{campaign.id}] Empty audience, marking campaign completed without scheduling"
      return
    end

    schedule_messages_with_throttling(contacts)
    campaign.completed!
    Rails.logger.info "[ApiCampaign #{campaign.id}] Campaign processed (scheduled_messages created, dispatch will pick them up)"
  end

  private

  delegate :inbox, :account, to: :campaign

  def validate_campaign!
    raise 'Invalid campaign — not Channel::Api inbox' unless inbox.inbox_type == 'Api'
    raise 'Invalid campaign — not one_off' unless campaign.one_off?
    raise 'Already processed' if campaign.completed?
    raise 'Evolution Campaigns feature not enabled' unless account.feature_enabled?(:api_campaign)
  end

  def fetch_audience
    label_titles = extract_audience_labels
    return Contact.none if label_titles.empty?

    account.contacts.tagged_with(label_titles, any: true).where.not(phone_number: [nil, ''])
  end

  def extract_audience_labels
    audience_label_ids = campaign.audience.select { |a| a['type'] == 'Label' }.pluck('id')
    account.labels.where(id: audience_label_ids).pluck(:title)
  end

  # Distribuye los send_at de cada contacto respetando:
  #   - El cap de 200/24h por inbox (rolling window)
  #   - El delay aleatorio 3-20s entre mensajes consecutivos
  #   - El scheduled_at de la campaign como punto de partida (o now si vacio/pasado)
  # Si la audiencia + ya programados excede 200 en las proximas 24h, los
  # excedentes se programan en el siguiente bucket de 24h, y asi sucesivamente.
  def schedule_messages_with_throttling(contacts)
    start_time = [campaign.scheduled_at, Time.current].compact.max
    used_slots = current_rolling_window_usage
    cursor = start_time
    bucket_count = used_slots

    contacts.each do |contact|
      # Si el bucket actual (24h desde la primera entrada del cursor) llenó, saltamos al siguiente
      if bucket_count >= DAILY_CAP_PER_INBOX
        cursor = next_bucket_start(cursor)
        bucket_count = 0
      end

      cursor += rand(MIN_DELAY_SECONDS..MAX_DELAY_SECONDS).seconds
      create_scheduled_message(contact: contact, send_at: cursor)
      bucket_count += 1
    end
  end

  def current_rolling_window_usage
    NodoScheduledMessage.in_rolling_window(inbox.id, ROLLING_WINDOW_HOURS).count
  end

  def next_bucket_start(current_cursor)
    current_cursor + ROLLING_WINDOW_HOURS.hours
  end

  def create_scheduled_message(contact:, send_at:)
    contact_inbox = ensure_contact_inbox(contact)
    return unless contact_inbox

    conversation = ensure_conversation(contact_inbox)

    NodoScheduledMessage.create!(
      account_id: account.id,
      inbox_id: inbox.id,
      conversation_id: conversation.id,
      conversation_display_id: conversation.display_id,
      content: campaign.message,
      send_at: send_at,
      status: 'pending',
      scheduled_by_user_id: campaign.sender_id,
      scheduled_via: 'campaign',
      attempts: 0,
      campaign_id: campaign.id,
      attachment_url: attachment_url_from_campaign,
      metadata: {
        contact_id: contact.id,
        campaign_id: campaign.id,
        campaign_title: campaign.title,
        request_origin: 'campaign',
        channel_type: 'Channel::Api',
        inbox_name: inbox.name
      }
    )
  rescue StandardError => e
    Rails.logger.error "[ApiCampaign #{campaign.id}] Failed scheduling for contact #{contact.id}: #{e.class} #{e.message}"
  end

  def ensure_contact_inbox(contact)
    ContactInbox.find_or_create_by!(contact_id: contact.id, inbox_id: inbox.id) do |ci|
      ci.source_id = contact.phone_number
    end
  rescue ActiveRecord::RecordInvalid => e
    Rails.logger.error "[ApiCampaign #{campaign.id}] Skip contact #{contact.id}: #{e.message}"
    nil
  end

  def ensure_conversation(contact_inbox)
    existing = Conversation.where(contact_inbox_id: contact_inbox.id, inbox_id: inbox.id, account_id: account.id).order(created_at: :desc).first
    return existing if existing

    Conversation.create!(
      account_id: account.id,
      inbox_id: inbox.id,
      contact_id: contact_inbox.contact_id,
      contact_inbox_id: contact_inbox.id,
      campaign_id: campaign.id,
      additional_attributes: { initiated_by: 'api_campaign', campaign_id: campaign.id }
    )
  end

  def attachment_url_from_campaign
    # La URL de imagen (opcional) viaja en campaign.template_params['attachment_url']
    # para reutilizar el JSONB existente sin agregar columnas al schema oficial.
    return nil if campaign.template_params.blank?

    url = campaign.template_params['attachment_url'].presence
    return nil unless url

    # Validacion basica de URL — la EF dispatch tambien revalida.
    return url if url.match?(%r{\Ahttps?://})

    Rails.logger.warn "[ApiCampaign #{campaign.id}] Invalid attachment_url, ignoring: #{url}"
    nil
  end
end
