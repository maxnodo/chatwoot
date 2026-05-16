<!--
  NODO PATCH 7: banner que aparece arriba del thread de mensajes cuando el
  contacto tiene mensajes programados pending. Le da contexto al operador
  antes de responder para evitar mensajes contradictorios.

  - Si total === 0 → no se renderiza.
  - Click "Ver todos" → expande lista con preview, timestamp y origen.
  - Cancelar inline llega en commit 7.3.
-->
<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useStore } from 'dashboard/composables/store';
import { useMapGetter } from 'dashboard/composables/store';
import { useI18n } from 'vue-i18n';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { es, enUS } from 'date-fns/locale';

const props = defineProps({
  conversationId: { type: [Number, String], required: true },
});

const store = useStore();
const { locale, t } = useI18n();
const expanded = ref(false);

const getForConversation = useMapGetter(
  'scheduledMessages/getForConversation'
);
const getSummaryForConversation = useMapGetter(
  'scheduledMessages/getSummaryForConversation'
);

const summary = computed(() =>
  getSummaryForConversation.value(props.conversationId)
);
const list = computed(() => getForConversation.value(props.conversationId));
const hasScheduled = computed(() => (summary.value?.total || 0) > 0);

const dateLocale = computed(() => (locale.value === 'es' ? es : enUS));

const nextSendAtPretty = computed(() => {
  if (!summary.value?.next_send_at) return '';
  const dt = new Date(summary.value.next_send_at);
  const distance = formatDistanceToNowStrict(dt, {
    addSuffix: true,
    locale: dateLocale.value,
  });
  const formatted = format(dt, 'd MMM, HH:mm', { locale: dateLocale.value });
  return `${formatted} (${distance})`;
});

const fetchDetails = () => {
  store.dispatch(
    'scheduledMessages/fetchForConversation',
    props.conversationId
  );
};

// Fetch al montar y cuando cambia el id de conversación.
onMounted(() => {
  if (props.conversationId) fetchDetails();
});

watch(
  () => props.conversationId,
  newId => {
    if (newId) fetchDetails();
  }
);

const toggleExpanded = () => {
  expanded.value = !expanded.value;
};

const formatItem = item => {
  const dt = new Date(item.send_at);
  return {
    ...item,
    formattedTime: format(dt, 'd MMM, HH:mm', { locale: dateLocale.value }),
    distance: formatDistanceToNowStrict(dt, {
      addSuffix: true,
      locale: dateLocale.value,
    }),
    preview:
      (item.content || '').length > 120
        ? `${item.content.slice(0, 120)}…`
        : item.content,
    isCampaign: item.source === 'campaign',
  };
};

const items = computed(() => list.value.map(formatItem));

// NODO PATCH 7.3: cancelar inline.
// Solo admin puede; el backend devuelve 401/403 si no.
// El feedback al user es optimista: dispatch + refresh summary/details.
const currentUserRole = useMapGetter('getCurrentRole');
const canCancel = computed(() => currentUserRole.value === 'administrator');

const handleCancel = async item => {
  // confirm rudimentario; idealmente reemplazar con un modal custom
  const ok = window.confirm(
    t('SCHEDULED_MESSAGES.BANNER.CONFIRM_CANCEL', {
      time: item.formattedTime,
    })
  );
  if (!ok) return;
  try {
    await store.dispatch('scheduledMessages/cancel', {
      id: item.id,
      conversationId: props.conversationId,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[scheduledMessages] cancel failed:', error?.message);
  }
};
</script>

<template>
  <div
    v-if="hasScheduled"
    class="mx-3 mt-2 mb-1 rounded-lg border border-n-violet-6 bg-n-violet-2 dark:bg-n-violet-3"
  >
    <div
      class="px-3 py-2 flex items-center gap-2 cursor-pointer select-none"
      @click="toggleExpanded"
    >
      <fluent-icon
        :icon="
          summary?.next_source === 'campaign'
            ? 'megaphone-outline'
            : 'send-clock-outline'
        "
        size="16"
        class="text-n-violet-11 flex-shrink-0"
      />
      <span class="text-xs text-n-violet-11">
        {{
          t('SCHEDULED_MESSAGES.BANNER.SUMMARY', {
            total: summary?.total || 0,
            next: nextSendAtPretty,
          })
        }}
      </span>
      <fluent-icon
        :icon="expanded ? 'chevron-up' : 'chevron-down'"
        size="14"
        class="ml-auto text-n-violet-11"
      />
    </div>
    <div
      v-if="expanded"
      class="px-3 pb-3 pt-0 border-t border-n-violet-5 flex flex-col gap-2 max-h-60 overflow-y-auto"
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="text-xs bg-n-alpha-1 rounded-md p-2"
      >
        <div class="flex items-center gap-2 mb-1">
          <fluent-icon
            :icon="
              item.isCampaign ? 'megaphone-outline' : 'send-clock-outline'
            "
            size="12"
            class="text-n-violet-11"
          />
          <span class="font-medium text-n-slate-12">
            {{ item.formattedTime }}
          </span>
          <span class="text-n-slate-11">· {{ item.distance }}</span>
          <span
            v-if="item.isCampaign && item.campaign"
            class="ml-auto text-xxs text-n-violet-11"
          >
            🏷️ {{ item.campaign.title }}
          </span>
          <!-- NODO PATCH 7.3: botón cancelar inline (solo admin) -->
          <button
            v-if="canCancel"
            type="button"
            class="ml-auto text-xxs text-n-ruby-11 hover:underline focus:outline-none"
            :title="t('SCHEDULED_MESSAGES.BANNER.CANCEL_TOOLTIP')"
            @click.stop="handleCancel(item)"
          >
            {{ t('SCHEDULED_MESSAGES.BANNER.CANCEL') }}
          </button>
        </div>
        <div class="text-n-slate-11 leading-snug whitespace-pre-line">
          {{ item.preview }}
        </div>
      </div>
    </div>
  </div>
</template>
