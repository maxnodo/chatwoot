<!--
  NODO PATCH 6: form de creación de campañas Channel::Api (Evolution).

  Diferencias vs SMSCampaignForm/WhatsAppCampaignForm:
  - No usa templates de Meta (mensaje libre).
  - Sumo campo opcional "URL de imagen" (https://...) — Evolution la descarga
    y la envía al cliente como adjunto.
  - Sumo indicador de quota: poll del endpoint /api_campaign_quota cada 30s
    para mostrar slots disponibles y bloquear el submit si hay una campaña
    activa en ese inbox.
  - Envia `template_params: { attachment_url: ... }` para reusar el JSONB
    existente sin migrations adicionales en `campaigns`.

  Las reglas de cap/delay/spread/exclusión se aplican en el backend
  (Api::OneoffCampaignService). Acá solo damos feedback visual.
-->
<script setup>
import { reactive, computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useVuelidate } from '@vuelidate/core';
import { required, minLength, url, maxLength } from '@vuelidate/validators';
import { useMapGetter } from 'dashboard/composables/store';
import { useStore } from 'dashboard/composables/store';

import Input from 'dashboard/components-next/input/Input.vue';
import TextArea from 'dashboard/components-next/textarea/TextArea.vue';
import Button from 'dashboard/components-next/button/Button.vue';
import ComboBox from 'dashboard/components-next/combobox/ComboBox.vue';
import TagMultiSelectComboBox from 'dashboard/components-next/combobox/TagMultiSelectComboBox.vue';

const emit = defineEmits(['submit', 'cancel']);

const { t } = useI18n();
const store = useStore();

const formState = {
  uiFlags: useMapGetter('campaigns/getUIFlags'),
  labels: useMapGetter('labels/getLabels'),
  inboxes: useMapGetter('inboxes/getApiInboxes'),
};

const initialState = {
  title: '',
  message: '',
  inboxId: null,
  scheduledAt: null,
  attachmentUrl: '',
  selectedAudience: [],
};

const state = reactive({ ...initialState });

// La URL es opcional, pero si viene tiene que ser https://
const httpsOnly = value => !value || /^https:\/\//i.test(value);

const rules = {
  title: { required, minLength: minLength(1) },
  // 4000 chars matchea con el límite que valida la EF schedule-message y deja
  // margen sobre el límite hard de WhatsApp (4096). El TextArea HTML enforza
  // 4000 inline, este Vuelidate lo respalda si llegara contenido pegado.
  message: { required, minLength: minLength(1), maxLength: maxLength(4000) },
  inboxId: { required },
  scheduledAt: { required },
  selectedAudience: { required },
  attachmentUrl: { httpsOnly, maxLength: maxLength(2000) },
};

const v$ = useVuelidate(rules, state);

const isCreating = computed(() => formState.uiFlags.value.isCreating);

const currentDateTime = computed(() => {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localTime.toISOString().slice(0, 16);
});

const mapToOptions = (items, valueKey, labelKey) =>
  items?.map(item => ({
    value: item[valueKey],
    label: item[labelKey],
  })) ?? [];

const audienceList = computed(() =>
  mapToOptions(formState.labels.value, 'id', 'title')
);

const inboxOptions = computed(() =>
  mapToOptions(formState.inboxes.value, 'id', 'name')
);

// === Quota indicator =========================================================
// Cada vez que cambia el inbox seleccionado o cada 30s, pega el endpoint
// /api_campaign_quota y muestra "te quedan X mensajes" + bloquea submit si
// ya hay una campaign activa.

const quota = ref(null);
const quotaError = ref(null);
let quotaTimer = null;

const accountId = computed(() => store.getters.getCurrentAccountId);

const fetchQuota = async () => {
  if (!state.inboxId || !accountId.value) {
    quota.value = null;
    return;
  }
  try {
    const path = `/api/v1/accounts/${accountId.value}/inboxes/${state.inboxId}/api_campaign_quota`;
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    quota.value = await res.json();
    quotaError.value = null;
  } catch (e) {
    quotaError.value = String(e?.message || e);
    quota.value = null;
  }
};

watch(() => state.inboxId, () => {
  fetchQuota();
});

onMounted(() => {
  quotaTimer = setInterval(() => {
    if (state.inboxId) fetchQuota();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (quotaTimer) clearInterval(quotaTimer);
});

const hasActiveCampaign = computed(
  () => !!quota.value?.active_campaign
);

const slotsAvailable = computed(() => quota.value?.slots_available ?? null);
const slotsUsed = computed(() => quota.value?.slots_used ?? null);
const dailyCap = computed(() => quota.value?.daily_cap ?? 200);
// ==============================================================================

const getErrorMessage = (field, errorKey) => {
  const baseKey = 'CAMPAIGN.EVOLUTION.CREATE.FORM';
  return v$.value[field].$error ? t(`${baseKey}.${errorKey}.ERROR`) : '';
};

const formErrors = computed(() => ({
  title: getErrorMessage('title', 'TITLE'),
  message: getErrorMessage('message', 'MESSAGE'),
  inbox: getErrorMessage('inboxId', 'INBOX'),
  scheduledAt: getErrorMessage('scheduledAt', 'SCHEDULED_AT'),
  audience: getErrorMessage('selectedAudience', 'AUDIENCE'),
  attachmentUrl: v$.value.attachmentUrl.$error
    ? t('CAMPAIGN.EVOLUTION.CREATE.FORM.ATTACHMENT_URL.ERROR')
    : '',
}));

const isSubmitDisabled = computed(() =>
  v$.value.$invalid || hasActiveCampaign.value
);

const formatToUTCString = localDateTime =>
  localDateTime ? new Date(localDateTime).toISOString() : null;

const resetState = () => {
  Object.assign(state, initialState);
};

const handleCancel = () => emit('cancel');

const prepareCampaignDetails = () => {
  const details = {
    title: state.title,
    message: state.message,
    inbox_id: state.inboxId,
    scheduled_at: formatToUTCString(state.scheduledAt),
    audience: state.selectedAudience?.map(id => ({
      id,
      type: 'Label',
    })),
  };
  // attachment_url viaja en template_params (JSONB reutilizable)
  if (state.attachmentUrl?.trim()) {
    details.template_params = {
      attachment_url: state.attachmentUrl.trim(),
    };
  }
  return details;
};

const handleSubmit = async () => {
  const isFormValid = await v$.value.$validate();
  if (!isFormValid || hasActiveCampaign.value) return;

  emit('submit', prepareCampaignDetails());
  resetState();
  handleCancel();
};
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
    <Input
      v-model="state.title"
      :label="t('CAMPAIGN.EVOLUTION.CREATE.FORM.TITLE.LABEL')"
      :placeholder="t('CAMPAIGN.EVOLUTION.CREATE.FORM.TITLE.PLACEHOLDER')"
      :message="formErrors.title"
      :message-type="formErrors.title ? 'error' : 'info'"
    />

    <TextArea
      v-model="state.message"
      :label="t('CAMPAIGN.EVOLUTION.CREATE.FORM.MESSAGE.LABEL')"
      :placeholder="t('CAMPAIGN.EVOLUTION.CREATE.FORM.MESSAGE.PLACEHOLDER')"
      show-character-count
      :max-length="4000"
      :message="formErrors.message"
      :message-type="formErrors.message ? 'error' : 'info'"
    />

    <Input
      v-model="state.attachmentUrl"
      :label="t('CAMPAIGN.EVOLUTION.CREATE.FORM.ATTACHMENT_URL.LABEL')"
      :placeholder="t('CAMPAIGN.EVOLUTION.CREATE.FORM.ATTACHMENT_URL.PLACEHOLDER')"
      :message="formErrors.attachmentUrl"
      :message-type="formErrors.attachmentUrl ? 'error' : 'info'"
    />

    <div class="flex flex-col gap-1">
      <label for="inbox" class="mb-0.5 text-sm font-medium text-n-slate-12">
        {{ t('CAMPAIGN.EVOLUTION.CREATE.FORM.INBOX.LABEL') }}
      </label>
      <ComboBox
        id="inbox"
        v-model="state.inboxId"
        :options="inboxOptions"
        :has-error="!!formErrors.inbox"
        :placeholder="t('CAMPAIGN.EVOLUTION.CREATE.FORM.INBOX.PLACEHOLDER')"
        :message="formErrors.inbox"
        class="[&>div>button]:bg-n-alpha-black2 [&>div>button:not(.focused)]:dark:outline-n-weak [&>div>button:not(.focused)]:hover:!outline-n-slate-6"
      />
    </div>

    <!-- Quota indicator (NODO PATCH 6) -->
    <div
      v-if="state.inboxId && quota"
      class="text-xs px-3 py-2 rounded-md"
      :class="hasActiveCampaign
        ? 'bg-n-amber-3 text-n-amber-12'
        : 'bg-n-alpha-2 text-n-slate-11'"
    >
      <template v-if="hasActiveCampaign">
        ⚠️ {{ t('CAMPAIGN.EVOLUTION.QUOTA.ACTIVE_CAMPAIGN', {
          title: quota.active_campaign.title,
          pending: quota.active_campaign.pending_count,
        }) }}
      </template>
      <template v-else>
        📊 {{ t('CAMPAIGN.EVOLUTION.QUOTA.AVAILABLE', {
          available: slotsAvailable,
          used: slotsUsed,
          cap: dailyCap,
        }) }}
      </template>
    </div>

    <div class="flex flex-col gap-1">
      <label for="audience" class="mb-0.5 text-sm font-medium text-n-slate-12">
        {{ t('CAMPAIGN.EVOLUTION.CREATE.FORM.AUDIENCE.LABEL') }}
      </label>
      <TagMultiSelectComboBox
        v-model="state.selectedAudience"
        :options="audienceList"
        :label="t('CAMPAIGN.EVOLUTION.CREATE.FORM.AUDIENCE.LABEL')"
        :placeholder="t('CAMPAIGN.EVOLUTION.CREATE.FORM.AUDIENCE.PLACEHOLDER')"
        :has-error="!!formErrors.audience"
        :message="formErrors.audience"
        class="[&>div>button]:bg-n-alpha-black2"
      />
    </div>

    <Input
      v-model="state.scheduledAt"
      :label="t('CAMPAIGN.EVOLUTION.CREATE.FORM.SCHEDULED_AT.LABEL')"
      type="datetime-local"
      :min="currentDateTime"
      :placeholder="t('CAMPAIGN.EVOLUTION.CREATE.FORM.SCHEDULED_AT.PLACEHOLDER')"
      :message="formErrors.scheduledAt"
      :message-type="formErrors.scheduledAt ? 'error' : 'info'"
    />

    <div class="flex items-center justify-between w-full gap-3">
      <Button
        variant="faded"
        color="slate"
        type="button"
        :label="t('CAMPAIGN.EVOLUTION.CREATE.FORM.BUTTONS.CANCEL')"
        class="w-full bg-n-alpha-2 text-n-blue-11 hover:bg-n-alpha-3"
        @click="handleCancel"
      />
      <Button
        :label="t('CAMPAIGN.EVOLUTION.CREATE.FORM.BUTTONS.CREATE')"
        class="w-full"
        type="submit"
        :is-loading="isCreating"
        :disabled="isCreating || isSubmitDisabled"
      />
    </div>
  </form>
</template>
