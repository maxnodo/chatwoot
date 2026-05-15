<!-- NODO PATCH 6: dialog wrapper para crear una campaña Evolution. -->
<script setup>
import { useI18n } from 'vue-i18n';
import { useStore } from 'dashboard/composables/store';
import { useAlert, useTrack } from 'dashboard/composables';
import { CAMPAIGN_TYPES } from 'shared/constants/campaign.js';
import { CAMPAIGNS_EVENTS } from 'dashboard/helper/AnalyticsHelper/events.js';

import EvolutionCampaignForm from 'dashboard/components-next/Campaigns/Pages/CampaignPage/EvolutionCampaign/EvolutionCampaignForm.vue';

const emit = defineEmits(['close']);

const store = useStore();
const { t } = useI18n();

const addCampaign = async campaignDetails => {
  try {
    await store.dispatch('campaigns/create', campaignDetails);

    useTrack(CAMPAIGNS_EVENTS.CREATE_CAMPAIGN, {
      type: CAMPAIGN_TYPES.ONE_OFF,
    });

    useAlert(t('CAMPAIGN.EVOLUTION.CREATE.FORM.API.SUCCESS_MESSAGE'));
  } catch (error) {
    // Mensajes friendly cuando el backend rechaza por exclusión mutua o feature flag
    const detail =
      error?.response?.data?.message ||
      error?.response?.message ||
      error?.message;
    useAlert(detail || t('CAMPAIGN.EVOLUTION.CREATE.FORM.API.ERROR_MESSAGE'));
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
        {{ t(`CAMPAIGN.EVOLUTION.CREATE.TITLE`) }}
      </h3>
      <EvolutionCampaignForm @submit="handleSubmit" @cancel="handleClose" />
    </div>
  </div>
</template>
