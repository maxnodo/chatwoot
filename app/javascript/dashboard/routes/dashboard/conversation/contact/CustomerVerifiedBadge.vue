<!--
  NODO PATCH 5: insignia "Cliente verificado" al lado del nombre del contacto
  cuando custom_attributes.etapa_comercial === 'Cierre'.

  La logica comercial (etapa, monto, probabilidad, notas, etc.) vive en los
  custom_attribute_definitions nativos de Chatwoot (Settings -> Custom
  Attributes). Este componente solo hace el rendering visual de la insignia
  azul tipo Twitter/X verified cuando el contacto llego a la etapa de cierre.

  Si en una v2 queremos persistencia (insignia se mantiene aunque la etapa
  vuelva atras) o tracking del momento exacto del cierre, se evalua mover a
  tabla dedicada nodo_opportunities. Por ahora, leemos en runtime.
-->
<script>
export default {
  props: {
    customAttributes: {
      type: Object,
      default: () => ({}),
    },
  },
  computed: {
    isCustomer() {
      const value = this.customAttributes?.etapa_comercial;
      if (!value) return false;
      // Comparacion case-insensitive y permite valor con/sin tilde.
      const normalized = value.toString().trim().toLowerCase();
      return normalized === 'cierre';
    },
  },
};
</script>

<template>
  <span
    v-if="isCustomer"
    v-tooltip.top="'Cliente verificado'"
    class="inline-flex items-center justify-center ml-1.5 align-middle"
    style="vertical-align: -2px"
  >
    <svg viewBox="0 0 22 22" width="14" height="14" aria-hidden="true">
      <path
        d="M11 2 L13.2 4.4 L16.5 3.9 L17 7.2 L20 8.7 L18.6 11.7 L20 14.7 L17 16.2 L16.5 19.5 L13.2 19 L11 21.4 L8.8 19 L5.5 19.5 L5 16.2 L2 14.7 L3.4 11.7 L2 8.7 L5 7.2 L5.5 3.9 L8.8 4.4 Z"
        fill="#1f93ff"
      />
      <path
        d="M7.5 11.2 L10 13.7 L14.8 8.9"
        fill="none"
        stroke="#fff"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </span>
</template>
