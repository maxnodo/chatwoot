class NodoMessageCampaignDraft < ApplicationRecord
  self.table_name = 'nodo_message_campaign_drafts'

  belongs_to :account
  belongs_to :inbox
  belongs_to :conversation
end
