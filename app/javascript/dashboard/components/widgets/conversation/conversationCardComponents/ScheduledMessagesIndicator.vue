<!--
  NODO PATCH 7: indicador en el ConversationCard de la bandeja cuando el
  contacto tiene mensajes programados pending.

  - Si total === 0 → no se renderiza (no ocupa espacio).
  - Diferencia visual entre 'manual' (Copilot) y 'campaign' (Patch 6).
  - Hover → tooltip con timestamp del próximo envío.
  - Estilo: chip pequeño, color violeta-suave para distinguir de unread (verde).
-->
<script setup>
import { computed } from 'vue';
import { useMapGetter } from 'dashboard/composables/store';
import { formatDistanceToNowStrict } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  conversationId: {
    type: [Number, String],
    required: true,
  },
});

const { locale } = useI18n();
const getSummaryForConversation = useMapGetter(
  'scheduledMessages/getSummaryForConversation'
);

const summary = computed(() =>
  getSummaryForConversation.value(props.conversationId)
);

const hasScheduled = computed(() => (summary.value?.total || 0) > 0);

const count = computed(() => summary.value?.total || 0);

const nextSource = computed(() => summary.value?.next_source || 'manual');

const icon = computed(() =>
  nextSource.value === 'campaign'
    ? 'megaphone-outline'
    : 'send-clock-outline'
);

const tooltip = computed(() => {
  if (!summary.value) return '';
  const dt = new Date(summary.value.next_send_at);
  const localeObj = locale.value === 'es' ? es : enUS;
  const distance = formatDistanceToNowStrict(dt, {
    addSuffix: true,
    locale: localeObj,
  });
  const manual = summary.value.manual_count || 0;
  const campaign = summary.value.campaign_count || 0;
  const parts = [];
  if (manual > 0) parts.push(`${manual} manual${manual > 1 ? 'es' : ''}`);
  if (campaign > 0)
    parts.push(`${campaign} de campaña${campaign > 1 ? 's' : ''}`);
  return `${parts.join(' + ')} · próximo ${distance}`;
});
</script>

<template>
  <span
    v-if="hasScheduled"
    :title="tooltip"
    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold leading-4 text-white bg-n-violet-9 dark:bg-n-violet-9 ring-1 ring-n-violet-11/30 align-middle"
  >
    <fluent-icon :icon="icon" size="14" />
    <span>{{ count }}</span>
  </span>
</template>
