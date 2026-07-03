<!--
  NODO PATCH 13: form de creación de campañas Telegram (Channel::Telegram).

  Política relajada vs Evolution (acá no hay riesgo de baneo del número):
  - Sin tope diario ni indicador de quota (la Bot API acepta ~30 msg/s; el
    service despacha a ~20/s).
  - Sin exclusión mutua al crear: se pueden dejar varias campañas programadas.
  - Solo llega a contactos que YA hablaron con el bot (regla dura de Telegram);
    los demás se saltean. La guardia de frecuencia por contacto (1 campaña / 7
    días) vive en el backend (Telegram::OneoffCampaignService).
-->
<script setup>
import { reactive, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useVuelidate } from '@vuelidate/core';
import { required, minLength, maxLength } from '@vuelidate/validators';
import { useMapGetter } from 'dashboard/composables/store';

import Input from 'dashboard/components-next/input/Input.vue';
import TextArea from 'dashboard/components-next/textarea/TextArea.vue';
import Button from 'dashboard/components-next/button/Button.vue';
import ComboBox from 'dashboard/components-next/combobox/ComboBox.vue';
import TagMultiSelectComboBox from 'dashboard/components-next/combobox/TagMultiSelectComboBox.vue';

const emit = defineEmits(['submit', 'cancel']);

const { t } = useI18n();

const formState = {
  uiFlags: useMapGetter('campaigns/getUIFlags'),
  labels: useMapGetter('labels/getLabels'),
  inboxes: useMapGetter('inboxes/getTelegramInboxes'),
};

const initialState = {
  title: '',
  message: '',
  inboxId: null,
  scheduledAt: null,
  selectedAudience: [],
};

const state = reactive({ ...initialState });

const rules = {
  title: { required, minLength: minLength(1) },
  message: { required, minLength: minLength(1), maxLength: maxLength(4000) },
  inboxId: { required },
  scheduledAt: { required },
  selectedAudience: { required },
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

const getErrorMessage = (field, errorKey) => {
  const baseKey = 'CAMPAIGN.TELEGRAM.CREATE.FORM';
  return v$.value[field].$error ? t(`${baseKey}.${errorKey}.ERROR`) : '';
};

const formErrors = computed(() => ({
  title: getErrorMessage('title', 'TITLE'),
  message: getErrorMessage('message', 'MESSAGE'),
  inbox: getErrorMessage('inboxId', 'INBOX'),
  scheduledAt: getErrorMessage('scheduledAt', 'SCHEDULED_AT'),
  audience: getErrorMessage('selectedAudience', 'AUDIENCE'),
}));

const isSubmitDisabled = computed(() => v$.value.$invalid);

const formatToUTCString = localDateTime =>
  localDateTime ? new Date(localDateTime).toISOString() : null;

const resetState = () => {
  Object.assign(state, initialState);
};

const handleCancel = () => emit('cancel');

const prepareCampaignDetails = () => ({
  title: state.title,
  message: state.message,
  inbox_id: state.inboxId,
  scheduled_at: formatToUTCString(state.scheduledAt),
  audience: state.selectedAudience?.map(id => ({
    id,
    type: 'Label',
  })),
});

const handleSubmit = async () => {
  const isFormValid = await v$.value.$validate();
  if (!isFormValid) return;

  emit('submit', prepareCampaignDetails());
  resetState();
  handleCancel();
};
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
    <Input
      v-model="state.title"
      :label="t('CAMPAIGN.TELEGRAM.CREATE.FORM.TITLE.LABEL')"
      :placeholder="t('CAMPAIGN.TELEGRAM.CREATE.FORM.TITLE.PLACEHOLDER')"
      :message="formErrors.title"
      :message-type="formErrors.title ? 'error' : 'info'"
    />

    <TextArea
      v-model="state.message"
      :label="t('CAMPAIGN.TELEGRAM.CREATE.FORM.MESSAGE.LABEL')"
      :placeholder="t('CAMPAIGN.TELEGRAM.CREATE.FORM.MESSAGE.PLACEHOLDER')"
      show-character-count
      :max-length="4000"
      :message="formErrors.message || t('CAMPAIGN.TELEGRAM.CREATE.FORM.MESSAGE.HINT')"
      :message-type="formErrors.message ? 'error' : 'info'"
    />

    <div class="flex flex-col gap-1">
      <label for="inbox" class="mb-0.5 text-sm font-medium text-n-slate-12">
        {{ t('CAMPAIGN.TELEGRAM.CREATE.FORM.INBOX.LABEL') }}
      </label>
      <ComboBox
        id="inbox"
        v-model="state.inboxId"
        :options="inboxOptions"
        :has-error="!!formErrors.inbox"
        :placeholder="t('CAMPAIGN.TELEGRAM.CREATE.FORM.INBOX.PLACEHOLDER')"
        :message="formErrors.inbox"
        class="[&>div>button]:bg-n-alpha-black2 [&>div>button:not(.focused)]:dark:outline-n-weak [&>div>button:not(.focused)]:hover:!outline-n-slate-6"
      />
    </div>

    <!-- NODO PATCH 13: regla dura de Telegram — solo se puede escribir a
         quienes ya iniciaron conversación con el bot. -->
    <div
      v-if="state.inboxId"
      class="text-xs px-3 py-2 rounded-md bg-n-alpha-2 text-n-slate-11"
    >
      ✈️ {{ t('CAMPAIGN.TELEGRAM.CREATE.FORM.REACH_NOTE') }}
    </div>

    <div class="flex flex-col gap-1">
      <label for="audience" class="mb-0.5 text-sm font-medium text-n-slate-12">
        {{ t('CAMPAIGN.TELEGRAM.CREATE.FORM.AUDIENCE.LABEL') }}
      </label>
      <TagMultiSelectComboBox
        v-model="state.selectedAudience"
        :options="audienceList"
        :label="t('CAMPAIGN.TELEGRAM.CREATE.FORM.AUDIENCE.LABEL')"
        :placeholder="t('CAMPAIGN.TELEGRAM.CREATE.FORM.AUDIENCE.PLACEHOLDER')"
        :has-error="!!formErrors.audience"
        :message="formErrors.audience"
        class="[&>div>button]:bg-n-alpha-black2"
      />
    </div>

    <Input
      v-model="state.scheduledAt"
      :label="t('CAMPAIGN.TELEGRAM.CREATE.FORM.SCHEDULED_AT.LABEL')"
      type="datetime-local"
      :min="currentDateTime"
      :placeholder="t('CAMPAIGN.TELEGRAM.CREATE.FORM.SCHEDULED_AT.PLACEHOLDER')"
      :message="formErrors.scheduledAt"
      :message-type="formErrors.scheduledAt ? 'error' : 'info'"
    />

    <div class="flex items-center justify-between w-full gap-3">
      <Button
        variant="faded"
        color="slate"
        type="button"
        :label="t('CAMPAIGN.TELEGRAM.CREATE.FORM.BUTTONS.CANCEL')"
        class="w-full bg-n-alpha-2 text-n-blue-11 hover:bg-n-alpha-3"
        @click="handleCancel"
      />
      <Button
        :label="t('CAMPAIGN.TELEGRAM.CREATE.FORM.BUTTONS.CREATE')"
        class="w-full"
        type="submit"
        :is-loading="isCreating"
        :disabled="isCreating || isSubmitDisabled"
      />
    </div>
  </form>
</template>
