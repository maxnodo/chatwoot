// NODO PATCH 7: API client para scheduled messages (read-only en este commit).
// Endpoints servidos por Api::V1::Accounts::ScheduledMessagesController.

import ApiClient from './ApiClient';

class ScheduledMessagesAPI extends ApiClient {
  constructor() {
    super('scheduled_messages', { accountScoped: true });
  }

  // GET /api/v1/accounts/:id/scheduled_messages/summary
  // → Map {conversation_id: {manual_count, campaign_count, total, next_send_at, next_source}}
  // Una sola request al cargar la bandeja, overlay sobre ConversationCards.
  getSummary() {
    return this.axios.get(`${this.url}/summary`);
  }

  // GET /api/v1/accounts/:id/scheduled_messages?conversation_id=N
  // Lista detallada para el banner en la conv abierta.
  getForConversation(conversationId) {
    return this.axios.get(this.url, {
      params: { conversation_id: conversationId },
    });
  }

  // DELETE /api/v1/accounts/:id/scheduled_messages/:id
  // Cancela un programado (status='cancelled'). Solo admin.
  cancel(id) {
    return this.axios.delete(`${this.url}/${id}`);
  }
}

export default new ScheduledMessagesAPI();
