<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  draftId: { type: Number, required: true },
  conversationId: { type: Number, required: true },
  status: { type: String, default: 'pending_review' },
});

const route = useRoute();
const { t } = useI18n();
const state = ref(props.status);
const error = ref('');
const loading = ref(false);
const date = ref(new Date(Date.now() + 60_000).toISOString().slice(0, 16));
const isPending = computed(() => state.value === 'pending_review');
const accountId = computed(() => route.params.accountId);
const endpoint = computed(
  () =>
    `/api/v1/accounts/${accountId.value}/conversations/${props.conversationId}/campaign_drafts/${props.draftId}`
);

const perform = async (action, payload = {}) => {
  loading.value = true;
  error.value = '';
  try {
    const response = await axios.post(`${endpoint.value}/${action}`, payload); // eslint-disable-line no-undef
    state.value =
      response.data.status || (action === 'approve' ? 'scheduled' : 'rejected');
  } catch (err) {
    error.value =
      err.response?.data?.error || t('CONVERSATION.CAMPAIGN_DRAFT.ACTION_ERROR');
  } finally {
    loading.value = false;
  }
};

const approve = () =>
  perform('approve', { send_at: new Date(date.value).toISOString() });
const reject = () => perform('reject');
const regenerate = () => perform('regenerate');
</script>

<template>
  <section
    class="mt-2 w-full max-w-xl rounded-xl border border-n-amber-7 bg-n-amber-2 p-3 text-n-slate-12"
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <span class="text-sm font-semibold">
        {{ t('CONVERSATION.CAMPAIGN_DRAFT.TITLE', { id: draftId }) }}
      </span>
      <span class="rounded-full bg-n-amber-4 px-2 py-0.5 text-xs font-medium">
        {{
          state === 'pending_review'
            ? t('CONVERSATION.CAMPAIGN_DRAFT.STATUS.PENDING_REVIEW')
            : state === 'scheduled'
              ? t('CONVERSATION.CAMPAIGN_DRAFT.STATUS.SCHEDULED')
              : t('CONVERSATION.CAMPAIGN_DRAFT.STATUS.REJECTED')
        }}
      </span>
    </div>
    <p v-if="isPending" class="mb-3 text-sm text-n-slate-11">
      {{ t('CONVERSATION.CAMPAIGN_DRAFT.PENDING_DESCRIPTION') }}
    </p>
    <div v-if="isPending" class="mb-3 flex items-center gap-2">
      <label class="text-xs font-medium" for="campaign-send-at">
        {{ t('CONVERSATION.CAMPAIGN_DRAFT.SEND_AT') }}
      </label>
      <input
        id="campaign-send-at"
        v-model="date"
        type="datetime-local"
        class="rounded-md border border-n-slate-6 bg-n-solid-1 px-2 py-1 text-sm"
      />
    </div>
    <div v-if="isPending" class="flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-md bg-n-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="loading"
        @click="approve"
      >
        {{ t('CONVERSATION.CAMPAIGN_DRAFT.APPROVE_AND_SCHEDULE') }}
      </button>
      <button
        type="button"
        class="rounded-md border border-n-slate-6 bg-n-solid-1 px-3 py-2 text-sm font-medium disabled:opacity-50"
        :disabled="loading"
        @click="regenerate"
      >
        {{ t('CONVERSATION.CAMPAIGN_DRAFT.REGENERATE') }}
      </button>
      <button
        type="button"
        class="rounded-md border border-n-ruby-8 bg-n-solid-1 px-3 py-2 text-sm font-medium text-n-ruby-11 disabled:opacity-50"
        :disabled="loading"
        @click="reject"
      >
        {{ t('CONVERSATION.CAMPAIGN_DRAFT.REJECT') }}
      </button>
    </div>
    <p v-if="error" class="mt-2 text-xs text-n-ruby-11">{{ error }}</p>
  </section>
</template>
