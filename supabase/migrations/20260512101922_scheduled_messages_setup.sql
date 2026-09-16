-- 1. Habilitar extensiones
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Tabla principal
CREATE TABLE IF NOT EXISTS public.nodo_scheduled_messages (
  id              BIGSERIAL PRIMARY KEY,
  account_id      INT       NOT NULL,
  inbox_id        INT       NOT NULL,
  conversation_id INT       NOT NULL,
  conversation_display_id INT,
  content         TEXT      NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  send_at         TIMESTAMPTZ NOT NULL,
  status          TEXT      NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','sent','failed','cancelled')),
  scheduled_by_user_id INT,
  scheduled_via   TEXT      DEFAULT 'copilot',
  attempts        INT       NOT NULL DEFAULT 0,
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,
  metadata        JSONB     DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Index para el worker que busca pending
CREATE INDEX IF NOT EXISTS idx_nsm_pending_send_at
  ON public.nodo_scheduled_messages (send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_nsm_conv
  ON public.nodo_scheduled_messages (account_id, conversation_id, status);

-- 4. Comentarios
COMMENT ON TABLE public.nodo_scheduled_messages IS
  'Mensajes programados por agentes vía Captain Copilot. Ejecutados por worker EF dispatch-scheduled-messages cada minuto.';
COMMENT ON COLUMN public.nodo_scheduled_messages.status IS
  'pending → sent | failed | cancelled. pending es el target del worker.';
COMMENT ON COLUMN public.nodo_scheduled_messages.scheduled_via IS
  'copilot (vía Captain) | api (POST manual) | ui (custom UI)';
