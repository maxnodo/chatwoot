# NODO PATCH 13: campañas one-off para Channel::Telegram.
#
# A diferencia de Api::OneoffCampaignService (Evolution), acá NO hace falta la
# maquinaria anti-baneo (nodo_scheduled_messages + goteo 3-20s + cap 200/24h):
# los bots de Telegram están hechos para difusión y Chatwoot entrega solo
# (Telegram::SendOnTelegramService via el listener de message_created).
#
# Política Telegram (definida en sesión del 3/07/2026):
#   - Envío directo sincrónico con throttle ~20 msg/s (la Bot API tolera ~30/s).
#   - SIN tope diario ni exclusión mutua al crear (se pueden encolar campañas).
#   - Alcance: SOLO contactos con contact_inbox en el inbox (= ya hablaron con
#     el bot; Telegram no permite iniciar conversación con desconocidos).
#   - Guardia de frecuencia: se saltea a quien ya recibió una campaña en este
#     inbox en los últimos 7 días (proteger la base de bloqueos/reportes).
#   - Variables {{nombre}}, {{empresa}}, etc. — reusa los resolvers de Patch 6.1.

class Telegram::OneoffCampaignService
  pattr_initialize [:campaign!]

  THROTTLE_SECONDS = 0.05
  CONTACT_FREQUENCY_DAYS = 7

  def perform
    validate_campaign!

    contacts = fetch_audience
    Rails.logger.info "[TelegramCampaign #{campaign.id}] Audience: #{contacts.count} contacts"

    if contacts.empty?
      campaign.completed!
      Rails.logger.warn "[TelegramCampaign #{campaign.id}] Empty audience, marking completed"
      return
    end

    sent = send_messages(contacts)
    campaign.completed!
    Rails.logger.info "[TelegramCampaign #{campaign.id}] Done — #{sent} messages sent"
  end

  private

  delegate :inbox, :account, to: :campaign

  def validate_campaign!
    raise 'Invalid campaign — not Channel::Telegram inbox' unless inbox.inbox_type == 'Telegram'
    raise 'Invalid campaign — not one_off' unless campaign.one_off?
    raise 'Already processed' if campaign.completed?
    # NODO PATCH 15: add-on propio (settings JSONB), separado del flag de Evolution
    raise 'Telegram Campaigns add-on not enabled' unless account.telegram_campaigns_enabled?
  end

  # Misma lógica dual de Patch 6 (labels de contacto + labels de conversación),
  # pero la "alcanzabilidad" acá NO es tener teléfono: es tener contact_inbox en
  # este inbox de Telegram (haber hablado con el bot alguna vez).
  def fetch_audience
    label_titles = extract_audience_labels
    return Contact.none if label_titles.empty?

    contact_ids_by_contact_label = account.contacts.tagged_with(label_titles, any: true).pluck(:id)
    contact_ids_by_conv_label    = contacts_via_conversation_labels(label_titles)

    candidate_ids = (contact_ids_by_contact_label + contact_ids_by_conv_label).uniq
    return Contact.none if candidate_ids.empty?

    reachable_ids = ContactInbox.where(inbox_id: inbox.id, contact_id: candidate_ids)
                                .distinct.pluck(:contact_id)
    skipped_unreachable = candidate_ids.size - reachable_ids.size
    Rails.logger.info "[TelegramCampaign #{campaign.id}] Skipping #{skipped_unreachable} contacts without bot conversation" if skipped_unreachable.positive?

    reachable_ids -= recently_campaigned_contact_ids(reachable_ids)
    account.contacts.where(id: reachable_ids)
  end

  def contacts_via_conversation_labels(label_titles)
    ActsAsTaggableOn::Tagging
      .joins('INNER JOIN tags ON tags.id = taggings.tag_id')
      .joins('INNER JOIN conversations ON conversations.id = taggings.taggable_id')
      .where(taggable_type: 'Conversation', context: 'labels')
      .where(conversations: { account_id: account.id })
      .where('tags.name IN (?)', label_titles)
      .pluck('conversations.contact_id')
      .compact
      .uniq
  end

  def extract_audience_labels
    audience_label_ids = campaign.audience.select { |a| a['type'] == 'Label' }.pluck('id')
    account.labels.where(id: audience_label_ids).pluck(:title)
  end

  # Guardia de frecuencia: contactos que YA recibieron un mensaje de campaña en
  # este inbox dentro de la ventana. Usa el índice GIN existente sobre
  # messages.additional_attributes->campaign_id.
  def recently_campaigned_contact_ids(candidate_ids)
    Message.joins(:conversation)
           .where(inbox_id: inbox.id, message_type: :outgoing)
           .where("(messages.additional_attributes ->> 'campaign_id') IS NOT NULL")
           .where('messages.created_at > ?', CONTACT_FREQUENCY_DAYS.days.ago)
           .where(conversations: { contact_id: candidate_ids })
           .distinct
           .pluck('conversations.contact_id')
  end

  def send_messages(contacts)
    sent = 0
    contacts.each do |contact|
      conversation = ensure_conversation(contact)
      next unless conversation

      conversation.messages.create!(
        account_id: account.id,
        inbox_id: inbox.id,
        message_type: :outgoing,
        content: render_message(campaign.message, contact),
        additional_attributes: { campaign_id: campaign.id }
      )
      sent += 1
      # ~20 msg/s — cómodo bajo el límite de ~30/s de la Bot API
      sleep THROTTLE_SECONDS
    rescue StandardError => e
      Rails.logger.error "[TelegramCampaign #{campaign.id}] Failed for contact #{contact.id}: #{e.class} #{e.message}"
    end
    sent
  end

  # Reusa la conversación existente del contacto en el inbox; si no hay, crea
  # una nueva SOLO si existe contact_inbox (nunca se puede fabricar un CI de
  # Telegram — el chat_id lo define Telegram cuando el usuario habla primero).
  def ensure_conversation(contact)
    existing = Conversation
               .where(contact_id: contact.id, inbox_id: inbox.id, account_id: account.id)
               .order(last_activity_at: :desc)
               .first
    return existing if existing

    contact_inbox = ContactInbox.where(contact_id: contact.id, inbox_id: inbox.id)
                                .order(created_at: :desc)
                                .first
    return nil unless contact_inbox

    Conversation.create!(
      account_id: account.id,
      inbox_id: inbox.id,
      contact_id: contact.id,
      contact_inbox_id: contact_inbox.id,
      campaign_id: campaign.id,
      additional_attributes: { initiated_by: 'telegram_campaign', campaign_id: campaign.id }
    )
  end

  # Variables por contacto — reusa los resolvers/fallbacks/pattern de Patch 6.1.
  def render_message(template, contact)
    return template.to_s if template.to_s.empty?
    return template unless template.include?('{{')

    template.gsub(Api::OneoffCampaignService::PLACEHOLDER_PATTERN) do
      key = Regexp.last_match(1)
      value = Api::OneoffCampaignService::PLACEHOLDER_RESOLVERS[key]&.call(contact)
      value.present? ? value : Api::OneoffCampaignService::PLACEHOLDER_FALLBACKS.fetch(key, '')
    end
  end
end
