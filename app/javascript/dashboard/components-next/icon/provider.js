import { computed } from 'vue';
import { isVoiceCallEnabled } from 'dashboard/helper/inbox';

export function useChannelIcon(inbox) {
  const channelTypeIconMap = {
    // NODO PATCH 1b: inboxes Channel::Api (Evolution) muestran el icono de
    // WhatsApp en la sidebar (en vez del icono default 'i-woot-api' que es
    // un brace generico). Antes lo haciamos con `sed` sobre los assets
    // compilados, pero al pasar a build completo (Dockerfile.nodo v4) tuvimos
    // que aplicarlo a nivel de source. El helper `dashboard/helper/inbox.js`
    // ya tenia este mapeo, pero la sidebar nativa usa este `provider.js`
    // (via ChannelLeaf -> ChannelIcon -> useChannelIcon).
    'Channel::Api': 'i-woot-whatsapp',
    'Channel::Email': 'i-woot-mail',
    'Channel::FacebookPage': 'i-woot-messenger',
    'Channel::Line': 'i-woot-line',
    'Channel::Sms': 'i-woot-sms',
    'Channel::Telegram': 'i-woot-telegram',
    'Channel::TwilioSms': 'i-woot-sms',
    'Channel::TwitterProfile': 'i-woot-x',
    'Channel::WebWidget': 'i-woot-website',
    'Channel::Whatsapp': 'i-woot-whatsapp',
    'Channel::Instagram': 'i-woot-instagram',
    'Channel::Tiktok': 'i-woot-tiktok',
  };

  const providerIconMap = {
    microsoft: 'i-woot-outlook',
    google: 'i-woot-gmail',
  };

  const channelIcon = computed(() => {
    const inboxDetails = inbox.value || inbox;
    const type = inboxDetails.channel_type;
    let icon = channelTypeIconMap[type];

    if (type === 'Channel::Email' && inboxDetails.provider) {
      if (Object.keys(providerIconMap).includes(inboxDetails.provider)) {
        icon = providerIconMap[inboxDetails.provider];
      }
    }

    // Special case for Twilio whatsapp
    if (type === 'Channel::TwilioSms' && inboxDetails.medium === 'whatsapp') {
      icon = 'i-woot-whatsapp';
    }

    // Special case for voice-enabled inboxes (Twilio, WhatsApp, etc.)
    if (isVoiceCallEnabled(inboxDetails)) {
      icon = 'i-woot-voice';
    }

    return icon ?? 'i-ri-global-fill';
  });

  return channelIcon;
}
