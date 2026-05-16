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

const dateLocale = computed(() => (locale.value === 'es' ? es : enUS));

// Distance "compacta" para mostrar al lado del chip ("en 2d", "en 30m", "ahora")
// Uso strict + sin sufijo "approximately"; le agrego "en " manualmente para que
// sea natural en español: "en 2d", "en 30m", etc.
const compactDistance = computed(() => {
  if (!summary.value?.next_send_at) return '';
  const dt = new Date(summary.value.next_send_at);
  const ms = dt.getTime() - Date.now();
  if (ms <= 0) return locale.value === 'es' ? 'ahora' : 'now';
  return formatDistanceToNowStrict(dt, {
    addSuffix: true,
    locale: dateLocale.value,
  });
});

// Label "1 programado" / "5 programados" según count (singular vs plural)
const label = computed(() => {
  const n = count.value;
  if (locale.value === 'es') {
    return n === 1 ? '1 programado' : `${n} programados`;
  }
  return n === 1 ? '1 scheduled' : `${n} scheduled`;
});

const tooltip = computed(() => {
  if (!summary.value) return '';
  const manual = summary.value.manual_count || 0;
  const campaign = summary.value.campaign_count || 0;
  const parts = [];
  if (manual > 0) parts.push(`${manual} manual${manual > 1 ? 'es' : ''}`);
  if (campaign > 0)
    parts.push(`${campaign} de campaña${campaign > 1 ? 's' : ''}`);
  return `${parts.join(' + ')} · próximo ${compactDistance.value}`;
});
</script>

<template>
  <span
    v-if="hasScheduled"
    :title="tooltip"
    class="inline-flex items-center gap-1 align-middle text-xs font-normal leading-4 text-n-violet-11"
  >
    <span
      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-n-violet-3 dark:bg-n-violet-3 text-n-violet-11"
    >
      <fluent-icon :icon="icon" size="12" />
      <span>{{ label }}</span>
    </span>
    <span class="opacity-80">·&nbsp;{{ compactDistance }}</span>
  </span>
</template>
