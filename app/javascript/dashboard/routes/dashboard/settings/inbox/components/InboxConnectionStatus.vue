<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  status: {
    type: String,
    default: '',
  },
});

const { t } = useI18n();

const status = computed(() =>
  ['connected', 'disconnected'].includes(props.status)
    ? props.status
    : 'unknown'
);

const statusClass = computed(
  () =>
    ({
      connected: 'bg-n-teal-9',
      disconnected: 'bg-n-ruby-9',
      unknown: 'bg-n-slate-7',
    })[status.value]
);

const statusLabel = computed(() =>
  t(`INBOX_MGMT.CONNECTION_STATUS.${status.value.toUpperCase()}`)
);
</script>

<template>
  <span
    v-tooltip.top="statusLabel"
    :aria-label="statusLabel"
    role="status"
    data-test-id="inbox-connection-status"
    class="size-2.5 rounded-full shrink-0 ring-2 ring-n-alpha-3"
    :class="statusClass"
  />
</template>
