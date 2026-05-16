// NODO PATCH 7: API client para scheduled messages.
// Endpoints servidos por Api::V1::Accounts::ScheduledMessagesController.
//
// IMPORTANTE: ApiClient de Chatwoot usa `axios` global (no this.axios).
// El comment `/* global axios */` evita el warning de ESLint no-undef.

/* global axios */

import ApiClient from './ApiClient';

class ScheduledMessagesAPI extends ApiClient {
  constructor() {
    super('scheduled_messages', { accountScoped: true });
  }

  // GET /api/v1/accounts/:id/scheduled_messages/summary
  // → Map {conversation_id: {manual_count, campaign_count, total, next_send_at, next_source}}
  // Una sola request al cargar la bandeja, overlay sobre ConversationCards.
  getSummary() {
    return axios.get(`${this.url}/summary`);
  }

  // GET /api/v1/accounts/:id/scheduled_messages?conversation_id=N
  // Lista detallada para el banner en la conv abierta.
  getForConversation(conversationId) {
    return axios.get(this.url, {
      params: { conversation_id: conversationId },
    });
  }

  // DELETE /api/v1/accounts/:id/scheduled_messages/:id
  // Cancela un programado (status='cancelled'). Solo admin.
  cancel(id) {
    return axios.delete(`${this.url}/${id}`);
  }
}

export default new ScheduledMessagesAPI();
