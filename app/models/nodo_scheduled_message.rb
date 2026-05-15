# NODO PATCH (Patch 6): modelo Rails para la tabla `nodo_scheduled_messages`.
# La tabla vive en el mismo Postgres que Chatwoot (Supabase project gonodo).
#
# La cola de mensajes programados es consumida por la EF Supabase
# `dispatch-scheduled-messages` (cron cada 60s) que despacha cada row al
# llegar su `send_at`.
#
# Patches relacionados:
#   - Patch 2 (Captain Copilot tools: schedule_message, list, update, cancel)
#   - Patch 6 (Campañas Channel::Api — crea N rows con `campaign_id` seteado)
#
# Columnas (creadas via SQL en Supabase, no por Rails migrations):
#   id, account_id, inbox_id, conversation_id, conversation_display_id,
#   content, send_at, status (pending|sent|cancelled|failed),
#   scheduled_by_user_id, scheduled_via, attempts, sent_at,
#   error_message, metadata (jsonb), created_at, updated_at,
#   attachment_url (Patch 6), campaign_id (Patch 6 FK to campaigns)
class NodoScheduledMessage < ApplicationRecord
  self.table_name = 'nodo_scheduled_messages'

  belongs_to :account
  belongs_to :inbox
  belongs_to :campaign, optional: true

  scope :pending, -> { where(status: 'pending') }
  scope :for_inbox, ->(inbox_id) { where(inbox_id: inbox_id) }

  # Rolling window de 24h: scheduled_messages (no cancelled, no failed) creados
  # en las últimas 24 horas para un inbox. Usado por el cap de 200/24h del
  # Patch 6 (Campañas Evolution).
  scope :in_rolling_window, lambda { |inbox_id, hours = 24|
    where(inbox_id: inbox_id)
      .where.not(status: %w[cancelled failed])
      .where('created_at > ?', hours.hours.ago)
  }
end
