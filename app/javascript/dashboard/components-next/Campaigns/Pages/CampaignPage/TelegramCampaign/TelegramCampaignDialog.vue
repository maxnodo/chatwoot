<!-- NODO PATCH 13: dialog wrapper para crear una campaña Telegram. -->
<script setup>
import { useI18n } from 'vue-i18n';
import { useStore } from 'dashboard/composables/store';
import { useAlert, useTrack } from 'dashboard/composables';
import { CAMPAIGN_TYPES } from 'shared/constants/campaign.js';
import { CAMPAIGNS_EVENTS } from 'dashboard/helper/AnalyticsHelper/events.js';

import TelegramCampaignForm from 'dashboard/components-next/Campaigns/Pages/CampaignPage/TelegramCampaign/TelegramCampaignForm.vue';

const emit = defineEmits(['close']);

const store = useStore();
const { t } = useI18n();

const addCampaign = async campaignDetails => {
  try {
    await store.dispatch('campaigns/create', campaignDetails);

    useTrack(CAMPAIGNS_EVENTS.CREATE_CAMPAIGN, {
      type: CAMPAIGN_TYPES.ONE_OFF,
    });

    useAlert(t('CAMPAIGN.TELEGRAM.CREATE.FORM.API.SUCCESS_MESSAGE'));
  } catch (error) {
    // Mensajes friendly cuando el backend rechaza por exclusión mutua o feature flag.
    // Chatwoot usa distintos shapes según el error:
    //   - RecordInvalid (validations) → { message, attributes }
    //   - ParameterMissing/otros     → { error }
    // Si nada de eso viene, dumpeamos el body crudo (truncado) para no ocultar la causa real.
    const data = error?.response?.data;
    const detail =
      data?.message ||
      data?.error ||
      data?.errors?.join?.(', ') ||
      (typeof data === 'string' ? data : null) ||
      (data ? JSON.stringify(data).slice(0, 300) : null) ||
      error?.message;
    useAlert(detail || t('CAMPAIGN.TELEGRAM.CREATE.FORM.API.ERROR_MESSAGE'));
    // eslint-disable-next-line no-console
    console.error('[Telegram campaign create] 422 body:', data, 'error:', error);
  }
};

const handleSubmit = campaignDetails => {
  addCampaign(campaignDetails);
};

const handleClose = () => emit('close');
</script>

<template>
  <div
    class="w-[25rem] z-50 min-w-0 absolute top-10 ltr:right-0 rtl:left-0 bg-n-alpha-3 backdrop-blur-[100px] rounded-xl border border-n-weak shadow-md max-h-[80vh] overflow-y-auto"
  >
    <div class="p-6 flex flex-col gap-6">
      <h3 class="text-base font-medium text-n-slate-12 flex-shrink-0">
        {{ t(`CAMPAIGN.TELEGRAM.CREATE.TITLE`) }}
      </h3>
      <TelegramCampaignForm @submit="handleSubmit" @cancel="handleClose" />
    </div>
  </div>
</template>
