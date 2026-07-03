<!--
  NODO PATCH 13: tab "Telegram" del menú de Campañas. Lista todas las campaigns
  one_off cuyos inboxes son Channel::Api (Telegram).

  Diferencias vs WhatsApp Cloud:
  - No usa templates de Meta (Telegram permite mensaje libre).
  - Permite imagen opcional vía URL pública (en lugar de template con header).
  - El dialog muestra un indicador de quota (200/24h por inbox, rolling window).
  - Solo 1 campaign activa por inbox a la vez (exclusión mutua del backend).
-->
<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToggle } from '@vueuse/core';
import { useStoreGetters, useMapGetter } from 'dashboard/composables/store';

import Spinner from 'dashboard/components-next/spinner/Spinner.vue';
import CampaignLayout from 'dashboard/components-next/Campaigns/CampaignLayout.vue';
import CampaignList from 'dashboard/components-next/Campaigns/Pages/CampaignPage/CampaignList.vue';
import TelegramCampaignDialog from 'dashboard/components-next/Campaigns/Pages/CampaignPage/TelegramCampaign/TelegramCampaignDialog.vue';
import ConfirmDeleteCampaignDialog from 'dashboard/components-next/Campaigns/Pages/CampaignPage/ConfirmDeleteCampaignDialog.vue';
import TelegramCampaignEmptyState from 'dashboard/components-next/Campaigns/EmptyState/TelegramCampaignEmptyState.vue';

const { t } = useI18n();
const getters = useStoreGetters();

const selectedCampaign = ref(null);
const [showTelegramCampaignDialog, toggleTelegramCampaignDialog] = useToggle();

const uiFlags = useMapGetter('campaigns/getUIFlags');
const isFetchingCampaigns = computed(() => uiFlags.value.isFetching);

const confirmDeleteCampaignDialogRef = ref(null);

const telegramCampaigns = computed(
  () => getters['campaigns/getTelegramCampaigns'].value
);

const hasNoTelegramCampaigns = computed(
  () => telegramCampaigns.value?.length === 0 && !isFetchingCampaigns.value
);

const handleDelete = campaign => {
  selectedCampaign.value = campaign;
  confirmDeleteCampaignDialogRef.value.dialogRef.open();
};
</script>

<template>
  <CampaignLayout
    :header-title="t('CAMPAIGN.TELEGRAM.HEADER_TITLE')"
    :button-label="t('CAMPAIGN.TELEGRAM.NEW_CAMPAIGN')"
    @click="toggleTelegramCampaignDialog()"
    @close="toggleTelegramCampaignDialog(false)"
  >
    <template #action>
      <TelegramCampaignDialog
        v-if="showTelegramCampaignDialog"
        @close="toggleTelegramCampaignDialog(false)"
      />
    </template>
    <div
      v-if="isFetchingCampaigns"
      class="flex items-center justify-center py-10 text-n-slate-11"
    >
      <Spinner />
    </div>
    <CampaignList
      v-else-if="!hasNoTelegramCampaigns"
      :campaigns="telegramCampaigns"
      @delete="handleDelete"
    />
    <TelegramCampaignEmptyState
      v-else
      :title="t('CAMPAIGN.TELEGRAM.EMPTY_STATE.TITLE')"
      :subtitle="t('CAMPAIGN.TELEGRAM.EMPTY_STATE.SUBTITLE')"
      class="pt-14"
    />
    <ConfirmDeleteCampaignDialog
      ref="confirmDeleteCampaignDialogRef"
      :selected-campaign="selectedCampaign"
    />
  </CampaignLayout>
</template>
