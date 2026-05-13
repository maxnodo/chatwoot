<!--
  NODO PATCH (Patch 4): muestra la hora local actual del contacto en la
  pestaña "Información de contacto", calculada a partir del country_code
  guardado en additional_attributes.

  - Country code -> timezone IANA (via countries-and-timezones).
  - Actualizacion cada 30s.
  - Si no hay country_code o no se puede resolver el timezone, el componente
    no renderiza nada (graceful degradation).
-->
<script>
import { getCountry } from 'countries-and-timezones';
import { utcToZonedTime, format } from 'date-fns-tz';
import ContactInfoRow from './ContactInfoRow.vue';

const UPDATE_INTERVAL_MS = 30 * 1000;

export default {
  components: {
    ContactInfoRow,
  },
  props: {
    countryCode: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      now: new Date(),
      tickHandle: null,
    };
  },
  computed: {
    timezone() {
      if (!this.countryCode) return null;
      try {
        const country = getCountry(this.countryCode.toUpperCase());
        if (!country || !country.timezones || country.timezones.length === 0) {
          return null;
        }
        // countries-and-timezones devuelve los timezones del pais ordenados.
        // Usamos el primero (mas representativo / capital en general).
        return country.timezones[0];
      } catch (_e) {
        return null;
      }
    },
    formattedLocalTime() {
      if (!this.timezone) return '';
      try {
        const zoned = utcToZonedTime(this.now, this.timezone);
        // Ej: "16:42 · CEST"
        const hhmm = format(zoned, 'HH:mm', { timeZone: this.timezone });
        const tzAbbr = format(zoned, 'zzz', { timeZone: this.timezone });
        return tzAbbr ? `${hhmm} · ${tzAbbr}` : hhmm;
      } catch (_e) {
        return '';
      }
    },
  },
  mounted() {
    this.tickHandle = setInterval(() => {
      this.now = new Date();
    }, UPDATE_INTERVAL_MS);
  },
  beforeUnmount() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  },
};
</script>

<template>
  <ContactInfoRow
    v-if="formattedLocalTime"
    :value="formattedLocalTime"
    icon="clock"
    emoji="🕒"
    title="Hora local del contacto"
  />
</template>
