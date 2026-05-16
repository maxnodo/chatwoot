<!--
  NODO PATCH 7: banner que aparece arriba del thread de mensajes cuando el
  contacto tiene mensajes programados pending. Le da contexto al operador
  antes de responder para evitar mensajes contradictorios.

  Diseño:
    - Header: chip cuadrado violeta con icono + título "N mensaje(s)
      programado(s)" + meta "próximo {fecha} · {hora} · en {distance}".
    - Lista expandida: cada item tiene columna izquierda apilada
      (fecha grande, hora destacada, distancia) y columna derecha con
      título (Recordatorio / nombre de campaign) + preview del mensaje.
      A la derecha: cancel inline (solo admin).
    - Márgenes laterales pensados para no chocar con los iconos flotantes
      derechos de Chatwoot (Contacto, Capitán, etc.).
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

// Header: pluraliza "1 mensaje programado" / "N mensajes programados".
const headerLabel = computed(() => {
  const n = summary.value?.total || 0;
  if (locale.value === 'es') {
    return n === 1 ? '1 mensaje programado' : `${n} mensajes programados`;
  }
  return n === 1 ? '1 scheduled message' : `${n} scheduled messages`;
});

// Meta del header: "18 may · 09:00 · en 1 día" (sin "próximo " porque el
// label ya da el contexto. Va separado de headerLabel para poder tipografiar
// distinto).
const nextDateLabel = computed(() => {
  if (!summary.value?.next_send_at) return '';
  const dt = new Date(summary.value.next_send_at);
  return format(dt, 'd MMM', { locale: dateLocale.value }).toLowerCase();
});

const nextTimeLabel = computed(() => {
  if (!summary.value?.next_send_at) return '';
  const dt = new Date(summary.value.next_send_at);
  return format(dt, 'HH:mm', { locale: dateLocale.value });
});

const nextDistance = computed(() => {
  if (!summary.value?.next_send_at) return '';
  const dt = new Date(summary.value.next_send_at);
  return formatDistanceToNowStrict(dt, {
    addSuffix: true,
    locale: dateLocale.value,
  });
});

const fetchDetails = () => {
  store.dispatch(
    'scheduledMessages/fetchForConversation',
    props.conversationId
  );
};

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

// Title de cada item:
//   - campaign → campaign.title (ej. "Promo Mayo")
//   - manual   → "Recordatorio" / "Reminder" (i18n)
const itemTitle = item => {
  if (item.source === 'campaign' && item.campaign?.title) {
    return item.campaign.title;
  }
  return locale.value === 'es' ? 'Recordatorio' : 'Reminder';
};

const formatItem = item => {
  const dt = new Date(item.send_at);
  return {
    ...item,
    // Columna izquierda apilada: fecha, hora, distancia
    dayUpper: format(dt, 'd MMM', { locale: dateLocale.value }).toUpperCase(),
    timeBig: format(dt, 'HH:mm', { locale: dateLocale.value }),
    distance: formatDistanceToNowStrict(dt, {
      addSuffix: true,
      locale: dateLocale.value,
    }),
    title: itemTitle(item),
    icon: item.source === 'campaign' ? 'megaphone-outline' : 'alert-outline',
    preview:
      (item.content || '').length > 180
        ? `${item.content.slice(0, 180)}…`
        : item.content,
    isCampaign: item.source === 'campaign',
  };
};

const items = computed(() => list.value.map(formatItem));

// NODO PATCH 7.3: cancelar inline. Solo admin puede.
const currentUserRole = useMapGetter('getCurrentRole');
const canCancel = computed(() => currentUserRole.value === 'administrator');

const handleCancel = async item => {
  const ok = window.confirm(
    t('SCHEDULED_MESSAGES.BANNER.CONFIRM_CANCEL', {
      time: `${item.dayUpper} ${item.timeBig}`,
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
  <!--
    Márgenes: ml-3 (igual que antes), mr-14 para no chocar con los iconos
    flotantes derechos (sidebar de Contacto / Capitán). max-w para que en
    pantallas grandes no se estire infinito.
  -->
  <div
    v-if="hasScheduled"
    class="ml-3 mr-14 mt-2 mb-1 rounded-xl border border-n-violet-5 bg-n-violet-2 dark:bg-n-violet-3"
  >
    <!-- HEADER -->
    <div
      class="px-3 py-2 flex items-center gap-3 cursor-pointer select-none"
      @click="toggleExpanded"
    >
      <!-- Chip cuadrado a la izquierda con icono de calendario -->
      <div
        class="flex-shrink-0 w-9 h-9 rounded-lg bg-n-violet-9 text-white flex items-center justify-center"
      >
        <fluent-icon
          :icon="
            summary?.next_source === 'campaign'
              ? 'megaphone-outline'
              : 'calendar-clock-outline'
          "
          size="18"
        />
      </div>

      <!-- Título + meta inline en una sola línea -->
      <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap text-sm">
        <span class="font-semibold text-n-slate-12">{{ headerLabel }}</span>
        <span class="text-n-slate-11">{{
          locale === 'es' ? 'próximo' : 'next'
        }}</span>
        <span class="font-medium text-n-violet-11">{{ nextDateLabel }}</span>
        <span class="text-n-slate-10">·</span>
        <span class="font-medium text-n-violet-11">{{ nextTimeLabel }}</span>
        <span class="text-n-slate-10">·</span>
        <span class="text-n-slate-11">{{ nextDistance }}</span>
      </div>

      <!-- Chevron -->
      <fluent-icon
        :icon="expanded ? 'chevron-up' : 'chevron-down'"
        size="16"
        class="text-n-slate-11 flex-shrink-0"
      />
    </div>

    <!-- LISTA EXPANDIDA -->
    <div
      v-if="expanded"
      class="px-3 pb-3 pt-0 flex flex-col gap-2 max-h-72 overflow-y-auto"
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="flex gap-3 bg-n-background dark:bg-n-alpha-1 rounded-lg p-3 border border-n-violet-3"
      >
        <!-- Columna izquierda: fecha + hora + distancia apilados -->
        <div
          class="flex-shrink-0 w-16 flex flex-col items-start leading-tight"
        >
          <span class="text-xs text-n-slate-11 uppercase tracking-wide">
            {{ item.dayUpper }}
          </span>
          <span class="text-lg font-bold text-n-violet-11">
            {{ item.timeBig }}
          </span>
          <span class="text-xxs text-n-slate-11">{{ item.distance }}</span>
        </div>

        <!-- Columna central: título (Recordatorio / Campaign) + preview -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 mb-0.5">
            <fluent-icon
              :icon="item.icon"
              size="14"
              class="text-n-violet-11 flex-shrink-0"
            />
            <span class="text-sm font-medium text-n-slate-12">
              {{ item.title }}
            </span>
          </div>
          <div
            class="text-sm text-n-slate-11 leading-snug whitespace-pre-line"
          >
            {{ item.preview }}
          </div>
        </div>

        <!-- Columna derecha: iconos de acción (cancel solo admin) -->
        <div class="flex-shrink-0 flex items-start gap-1">
          <!-- placeholder edit icon — deshabilitado hasta tener UI de edit -->
          <span
            class="text-n-slate-9 opacity-30 cursor-not-allowed"
            :title="locale === 'es' ? 'Editar (próximamente)' : 'Edit (soon)'"
          >
            <fluent-icon icon="edit-outline" size="14" />
          </span>
          <button
            v-if="canCancel"
            type="button"
            class="text-n-ruby-11 hover:text-n-ruby-9 focus:outline-none p-0.5 rounded hover:bg-n-ruby-3"
            :title="t('SCHEDULED_MESSAGES.BANNER.CANCEL_TOOLTIP')"
            @click.stop="handleCancel(item)"
          >
            <fluent-icon icon="dismiss-outline" size="14" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
