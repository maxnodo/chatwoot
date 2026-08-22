/* global axios */

import ApiClient from './ApiClient';

class CampaignsAPI extends ApiClient {
  constructor() {
    super('campaigns', { accountScoped: true });
  }

  // NODO PATCH 12: quota de campañas Evolution por inbox. Usa el axios global
  // (con headers de auth del dashboard) — el fetch plano que usaba el form
  // devolvía 401 y dejaba el formulario sin la protección preventiva.
  getApiCampaignQuota(inboxId) {
    return axios.get(`${this.baseUrl()}/inboxes/${inboxId}/api_campaign_quota`);
  }

  analyticsMetrics(id) {
    return axios.get(`${this.url}/${id}/analytics/metrics`);
  }

  analyticsContacts(id, { status, page } = {}) {
    return axios.get(`${this.url}/${id}/analytics/contacts`, {
      params: { status, page },
    });
  }
}

export default new CampaignsAPI();
