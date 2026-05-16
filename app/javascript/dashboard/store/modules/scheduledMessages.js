// NODO PATCH 7: store de mensajes programados para indicador en bandeja +
// banner en conversación. Read-only en este commit (cancel viene en 7.3).
//
// Shape:
//   state.summary = { [conversationId]: { manual_count, campaign_count, total,
//                                          next_send_at, next_source } }
//   state.byConversation = { [conversationId]: [ {id, content, send_at, ...} ] }

import ScheduledMessagesAPI from '../../api/scheduledMessages';

const types = {
  SET_SUMMARY: 'SCHED_SET_SUMMARY',
  SET_FOR_CONVERSATION: 'SCHED_SET_FOR_CONVERSATION',
  CLEAR_FOR_CONVERSATION: 'SCHED_CLEAR_FOR_CONVERSATION',
  SET_UI_FLAG: 'SCHED_SET_UI_FLAG',
};

const state = {
  summary: {},
  byConversation: {},
  uiFlags: {
    isFetchingSummary: false,
    isFetchingDetails: false,
  },
};

export const getters = {
  // Devuelve el summary de una conversation (o null si no tiene scheduled).
  // Lo consume ConversationCard para mostrar el ícono.
  getSummaryForConversation: $state => conversationId => {
    return $state.summary[conversationId] || null;
  },
  // Total agregado (manuales + campaigns) sobre todas las convs. Útil para
  // un eventual indicador global en el sidebar.
  getTotalCount: $state =>
    Object.values($state.summary).reduce(
      (acc, entry) => acc + (entry.total || 0),
      0
    ),
  // Lista detallada de scheduled de una conv específica (para banner).
  getForConversation: $state => conversationId => {
    return $state.byConversation[conversationId] || [];
  },
  getUIFlags: $state => $state.uiFlags,
};

export const actions = {
  fetchSummary: async ({ commit }) => {
    commit(types.SET_UI_FLAG, { isFetchingSummary: true });
    try {
      const { data } = await ScheduledMessagesAPI.getSummary();
      commit(types.SET_SUMMARY, data);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[scheduledMessages] fetchSummary failed:', error?.message);
    } finally {
      commit(types.SET_UI_FLAG, { isFetchingSummary: false });
    }
  },

  fetchForConversation: async ({ commit }, conversationId) => {
    if (!conversationId) return;
    commit(types.SET_UI_FLAG, { isFetchingDetails: true });
    try {
      const { data } = await ScheduledMessagesAPI.getForConversation(
        conversationId
      );
      commit(types.SET_FOR_CONVERSATION, { conversationId, list: data });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        '[scheduledMessages] fetchForConversation failed:',
        error?.message
      );
    } finally {
      commit(types.SET_UI_FLAG, { isFetchingDetails: false });
    }
  },

  clearForConversation: ({ commit }, conversationId) => {
    commit(types.CLEAR_FOR_CONVERSATION, conversationId);
  },
};

export const mutations = {
  [types.SET_SUMMARY]($state, summary) {
    $state.summary = summary || {};
  },
  [types.SET_FOR_CONVERSATION]($state, { conversationId, list }) {
    $state.byConversation = {
      ...$state.byConversation,
      [conversationId]: list || [],
    };
  },
  [types.CLEAR_FOR_CONVERSATION]($state, conversationId) {
    const { [conversationId]: _removed, ...rest } = $state.byConversation;
    $state.byConversation = rest;
  },
  [types.SET_UI_FLAG]($state, flags) {
    $state.uiFlags = { ...$state.uiFlags, ...flags };
  },
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations,
};
