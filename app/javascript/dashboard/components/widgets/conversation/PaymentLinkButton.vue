<script>
// NODO PATCH 9: botón "€" en el composer para generar un link de pago Stripe.
// Al generar, inserta el link directo en el mensaje (emite insert-payment-link).
// El backend (edge function create-payment-link) crea el Payment Link en la
// cuenta conectada del cliente con la comisión de Nodo como application_fee.
// El cobro y la confirmación ("✅ Pago recibido") los maneja el webhook aparte.
import { mapGetters } from 'vuex';
import { useAlert } from 'dashboard/composables';
import NextButton from 'dashboard/components-next/button/Button.vue';
import Modal from 'dashboard/components/Modal.vue';

// La anon key de Supabase es pública (publishable) — segura en frontend.
const SUPABASE_FN_URL =
  'https://ntncrklsckzmoaincafs.supabase.co/functions/v1/create-payment-link';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bmNya2xzY2t6bW9haW5jYWZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzAyNDgsImV4cCI6MjA5MTA0NjI0OH0.ddgy4qYZI6EHudHLvHeieQCWlBimhW6YTjVLEJ27z-Y';

export default {
  name: 'PaymentLinkButton',
  components: { NextButton, Modal },
  props: {
    // display_id de la conversación (currentChat.id en el frontend de Chatwoot)
    conversationId: {
      type: Number,
      default: 0,
    },
    // NODO PATCH 9: en Evolution (Baileys) un mensaje con texto + URL rompe el
    // envío (el link preview falla con URLs de Stripe). En ese canal mandamos
    // SOLO la URL aislada. En WhatsApp Cloud (Meta maneja el preview) va el
    // texto descriptivo + link sin problema.
    bareLinkOnly: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['insertPaymentLink'],
  data() {
    return {
      showModal: false,
      amount: '',
      concept: '',
      isLoading: false,
      // El botón se oculta hasta confirmar que la cuenta tiene pagos activos.
      paymentsEnabled: false,
    };
  },
  computed: {
    ...mapGetters({ accountId: 'getCurrentAccountId' }),
    isValid() {
      const amt = Number(this.amount);
      return amt > 0 && amt <= 10000 && this.concept.trim().length > 0;
    },
  },
  mounted() {
    this.checkPaymentsEnabled();
  },
  watch: {
    accountId() {
      this.checkPaymentsEnabled();
    },
  },
  methods: {
    // Consulta si la cuenta tiene un provider de pagos activo (gating per-account,
    // controlado desde la tabla nodo_payment_providers — sin feature flag).
    async checkPaymentsEnabled() {
      this.paymentsEnabled = false;
      if (!this.accountId) return;
      try {
        const res = await fetch(
          `${SUPABASE_FN_URL}?account_id=${this.accountId}`,
          { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
        );
        const data = await res.json();
        this.paymentsEnabled = !!(data && data.enabled);
      } catch {
        this.paymentsEnabled = false;
      }
    },
    openModal() {
      this.amount = '';
      this.concept = '';
      this.showModal = true;
    },
    closeModal() {
      this.showModal = false;
    },
    async generate() {
      if (!this.isValid || this.isLoading) return;
      this.isLoading = true;
      try {
        const res = await fetch(SUPABASE_FN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            account_id: this.accountId,
            amount: Number(this.amount),
            concept: this.concept.trim(),
            conversation_display_id: this.conversationId,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          const detail =
            (data && (data.error || JSON.stringify(data.detail))) ||
            'Error desconocido';
          useAlert(`No se pudo crear el link de pago: ${detail}`);
          return;
        }
        // Texto que se inserta en el mensaje.
        // El emoji y el texto se entregan sin problema en ambos canales. Lo
        // único que rompía Evolution era la URL "limpia": Baileys la detecta,
        // intenta generar el link preview de Stripe, falla, y el mensaje NO se
        // envía. Envuelta en negrita markdown (**url**) Baileys NO la detecta
        // como URL → no intenta preview → entrega. (Comprobado en prod.)
        // WhatsApp Cloud: Meta maneja el preview server-side, la URL va limpia.
        const eur = Number(this.amount).toFixed(2);
        const linkPart = this.bareLinkOnly ? `**${data.url}**` : data.url;
        const text = `💳 Podés abonar ${eur} € (${this.concept.trim()}) de forma segura acá:\n\n${linkPart}`;
        this.$emit('insertPaymentLink', text);
        useAlert(`Link de pago generado por ${eur} €`);
        this.closeModal();
      } catch (e) {
        useAlert(`Error de red al generar el link: ${e.message}`);
      } finally {
        this.isLoading = false;
      }
    },
  },
};
</script>

<template>
  <span v-if="paymentsEnabled">
    <NextButton
      v-tooltip.top-end="'Crear link de pago'"
      icon="i-ph-currency-eur"
      slate
      faded
      sm
      @click="openModal"
    />
    <Modal v-model:show="showModal" :on-close="closeModal" size="medium">
      <div class="flex flex-col gap-4 p-6">
        <h3 class="text-lg font-medium text-n-slate-12">
          💳 Crear link de pago
        </h3>
        <p class="text-sm text-n-slate-11">
          Generá un link de cobro seguro. El monto se acredita en la cuenta del
          negocio y se inserta en el mensaje listo para enviar.
        </p>

        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium text-n-slate-12">Monto (€)</span>
          <input
            v-model="amount"
            type="number"
            min="0.5"
            max="10000"
            step="0.01"
            placeholder="Ej: 45.00"
            class="px-3 py-2 rounded-lg border border-n-weak bg-n-alpha-black2 text-n-slate-12"
            @keydown.enter.prevent="generate"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium text-n-slate-12">Concepto</span>
          <input
            v-model="concept"
            type="text"
            maxlength="200"
            placeholder="Ej: Seña reserva mesa terraza"
            class="px-3 py-2 rounded-lg border border-n-weak bg-n-alpha-black2 text-n-slate-12"
            @keydown.enter.prevent="generate"
          />
        </label>

        <div class="flex gap-2 justify-end mt-2">
          <NextButton faded slate label="Cancelar" @click="closeModal" />
          <NextButton
            :disabled="!isValid || isLoading"
            :is-loading="isLoading"
            label="Generar link"
            @click="generate"
          />
        </div>
      </div>
    </Modal>
  </span>
</template>
