# Chatwoot — Fork de Comunidad Nodo

Este fork mantiene una serie de patches sobre el código upstream de
[`chatwoot/chatwoot`](https://github.com/chatwoot/chatwoot) que extienden la
funcionalidad para los requerimientos específicos de **Comunidad Nodo**.

---

## Estrategia

- **Rama upstream** (`develop`, `master`, tags): se mantiene como mirror del repo
  oficial. No se commitea nada acá.
- **Rama de trabajo** (`nodo-customizations`): vive a partir de un tag estable
  (`v4.13.0` actualmente). Acá viven todos los patches.

Cada vez que sale una versión nueva de Chatwoot upstream, se rebasea
`nodo-customizations` contra el nuevo tag, se resuelven conflictos (si los
hay) y se rebuildea la imagen.

---

## Patches activos

| # | Archivo | Propósito |
|---|---|---|
| 1 | `app/javascript/dashboard/helper/inbox.js` + `app/javascript/dashboard/components-next/icon/provider.js` (1b) | Icono `Channel::Api` muestra logo de WhatsApp en TODAS las vistas: sidebar nativa (via `provider.js`/`ChannelIcon`), InboxCard, ConversationCard, etc. (via `helper/inbox.js`). |
| 2 | `enterprise/app/services/captain/copilot/chat_service.rb` | (a) El Copilot expone los `captain_custom_tools` del account al modelo (Chatwoot v4.13.0 solo los expone al Captain Assistant, no al Copilot). (b) Inyecta la **fecha y hora actuales** (UTC + Madrid) al contexto del LLM, así herramientas con timestamps (`send_at` de `schedule_message`) no usan el año del training cutoff del modelo (que devuelve fechas de 2023). |
| 4 | `app/javascript/dashboard/routes/dashboard/conversation/contact/ContactLocalTime.vue` (new) + `ContactInfo.vue` (edit) | Muestra la **hora local actual del contacto** en el panel "Información de contacto", calculada a partir del `country_code` que ya guarda Chatwoot. Resuelve el timezone via `countries-and-timezones` y formatea con `date-fns-tz`. Se refresca cada 30s. Graceful degradation: si no hay country_code seteado, no aparece nada. |
| 5 | `CustomerVerifiedBadge.vue` (new) + `ContactInfo.vue` (edit) + `components-next/Conversation/ConversationCard/ConversationCard.vue` (edit 5b) + `components/widgets/conversation/ConversationCard.vue` (edit 5b legacy) | **Insignia ✓ azul "Cliente verificado"** al lado del nombre del contacto cuando `custom_attributes.etapa_comercial === 'Cierre'`. Aparece en (a) panel "Información de contacto", (b) bandeja de entrada principal (`ConversationCard` legacy) y (c) historial de conversaciones del contacto (`ConversationCard` next). El "legacy" se usa en la bandeja principal y trae el contacto via `store.getters['contacts/getContact']` (full shape con `custom_attributes`). El "next" se usa en sidebar contextual y recibe `contact` via prop. Acompañado de 7 Custom Attributes nativos creados en la cuenta (ver sección "Tab Comercial — Nivel B" más abajo) que conforman un mini-CRM dentro de Chatwoot **sin necesidad de tablas/UI custom**. Estética tipo Twitter/X verified. |
| 6 | **Backend:** `config/features.yml` (entry `api_campaign`) + `app/models/campaign.rb` (whitelist + dispatcher + validations) + `app/models/nodo_scheduled_message.rb` (new) + `app/services/api/oneoff_campaign_service.rb` (new) + `app/controllers/api/v1/accounts/inboxes/api_campaign_quotas_controller.rb` (new) + `config/routes.rb` (edit). **Frontend:** `app/javascript/dashboard/featureFlags.js` + `routes/dashboard/campaigns/campaigns.routes.js` + `components-next/sidebar/Sidebar.vue` + `store/modules/{campaigns,inboxes}.js` + 4 componentes Vue nuevos en `components-next/Campaigns/.../EvolutionCampaign/` + `routes/.../pages/EvolutionCampaignsPage.vue` + `i18n/locale/{es,en}/{campaign,settings}.json`. **EFs:** `schedule-message` v7 (acepta `attachment_url` + `campaign_id`) + `dispatch-scheduled-messages` v2 (descarga imagen y la sube multipart a Chatwoot). | **Campañas para Channel::Api (Evolution)** — backend + frontend + EFs completo. Cap 200/24h rolling window por inbox, delay aleatorio 3-20s entre mensajes, spread automático si la audiencia excede 200 (la misma campaign se distribuye en N ventanas de 24h), exclusión mutua per-inbox (solo 1 campaign Evolution activa por inbox), soporte de imagen opcional vía URL pública. Tab dedicado "Evolution" en sidebar de Campañas, form sin templates con campo `attachment_url`, indicador de quota en tiempo real (poll cada 30s) que bloquea el submit si ya hay una campaign activa. Activable como **add-on premium** desde el panel `/super_admin/accounts/:id/edit` (checkbox "Evolution Campaigns" en sección Premium Features). Ver sección "Patch 6 — Campañas Channel::Api" más abajo. |

---

## Build & deploy

### Automático (vía GitHub Actions)

Cada push a `nodo-customizations` dispara
`.github/workflows/build-nodo-image.yml`, que builda y publica la imagen en
GitHub Container Registry:

```
ghcr.io/maxnodo/chatwoot:v4.13.0-nodo.{run_number}
ghcr.io/maxnodo/chatwoot:latest
```

### Manual

```bash
# Build local
docker build -f docker/Dockerfile.nodo \
  --build-arg CHATWOOT_VERSION=v4.13.0 \
  -t ghcr.io/maxnodo/chatwoot:v4.13.0-nodo.1 .

# Login (requiere PAT con write:packages)
echo "$GITHUB_PAT" | docker login ghcr.io -u maxnodo --password-stdin

# Push
docker push ghcr.io/maxnodo/chatwoot:v4.13.0-nodo.1
```

### Deploy en VPS (EasyPanel)

1. SSH al VPS y hacer `docker login ghcr.io` con el PAT (solo la primera vez).
2. En EasyPanel → Stack `nodowoot` → cambiar el `image:` de los servicios
   `chatwoot` y `chatwoot-sidekiq`:
   - **Antes:** `chatwoot/chatwoot:v4.13.0`
   - **Después:** `ghcr.io/maxnodo/chatwoot:v4.13.0-nodo.1` (o `:latest`)
3. Deploy → Chatwoot levanta con los patches aplicados.

### Rollback

Volver el `image:` en EasyPanel a `chatwoot/chatwoot:v4.13.0`. Redeploy y listo.
Toma <5 minutos volver a la imagen oficial intacta.

---

## Cómo actualizar contra una nueva versión de Chatwoot

```bash
cd ~/Documents/Nodo/chatwoot-fork/chatwoot

# 1. Bajar las novedades upstream
git fetch upstream --tags

# 2. Cambiar a la rama de trabajo
git checkout nodo-customizations

# 3. Rebasear contra el nuevo tag (ej. v4.14.0)
git rebase v4.14.0

# 4a. Si NO hay conflictos: listo, push
git push --force-with-lease origin nodo-customizations

# 4b. Si HAY conflictos:
#   - git status muestra los archivos en conflicto
#   - Editás manualmente, re-aplicás la lógica del patch
#   - git add <archivo>
#   - git rebase --continue
#   - Repetir hasta que termine
#   - git push --force-with-lease origin nodo-customizations

# 5. GitHub Actions rebuildea la imagen automáticamente

# 6. En EasyPanel: cambiar el `image:` al nuevo tag y deploy
```

### Estrategia ante updates major (v4.x → v5.0)

Cuando Chatwoot saque una versión major, los patches probablemente generan
conflictos no triviales (los archivos pueden haber sido reorganizados o
reescritos). En ese caso:

1. **Crear branch nueva** `nodo-customizations-v5` desde el tag de la nueva
   versión.
2. **Re-aplicar los patches manualmente** (no rebase, copia-pega adaptando al
   código nuevo).
3. **Validar con smoke tests** (subir el icono cambia, Copilot invoca el
   custom tool).
4. **Cambiar la imagen en EasyPanel** solo cuando esté validado.
5. **Mantener la branch vieja** hasta confirmar que todo va bien en prod
   (semanas), después la podés borrar.

---

## Archivos del fork (no del upstream)

| Archivo | Función |
|---|---|
| `docker/Dockerfile.nodo` | Imagen custom de Chatwoot — **a partir de la versión `v4`, build completo desde sources** (en vez de derivar de `chatwoot/chatwoot:v4.13.0` pre-built). Más lento (~8-12 min) pero necesario para que cambios en componentes Vue/CSS se compilen correctamente. |
| `.github/workflows/build-nodo-image.yml` | CI/CD que builda y publica la imagen en GHCR. |
| `README_NODO.md` | Este documento. |

---

## Configuración de Active Storage (CRÍTICO)

Chatwoot guarda los attachments (imágenes, audios, archivos) usando Rails Active Storage.
Por **default** está configurado como `local` (disk en `/app/storage` del container) — pero
con `chatwoot` (web) y `chatwoot-sidekiq` corriendo en containers **separados**, esto rompe
las imágenes incoming de WhatsApp Cloud (sidekiq descarga el archivo, lo guarda en su disk
local, y el web service no lo encuentra al servirlo → 404).

**La configuración correcta es Supabase Storage como backend S3-compatible.** Bucket usado:
`chatwoot-storage` en el project Supabase `gonodo` (ref `ntncrklsckzmoaincafs`).

### Env vars requeridas en AMBOS servicios (`chatwoot` + `chatwoot-sidekiq`)

```
ACTIVE_STORAGE_SERVICE=s3_compatible
STORAGE_ACCESS_KEY_ID=<access_key_id del bucket>
STORAGE_SECRET_ACCESS_KEY=<secret_access_key del bucket>
STORAGE_REGION=eu-west-1
STORAGE_BUCKET_NAME=chatwoot-storage
STORAGE_ENDPOINT=https://ntncrklsckzmoaincafs.supabase.co/storage/v1/s3
STORAGE_FORCE_PATH_STYLE=true
```

### Cómo generar las S3 access keys del bucket

1. Dashboard Supabase → project gonodo → `Storage` → Settings → sección **"S3 Access Keys"**:
   `https://supabase.com/dashboard/project/ntncrklsckzmoaincafs/storage/settings`
2. Click "New access key" → asignar nombre (ej: `s3nodo` o `chatwoot-prod`)
3. **El secret access key solo se muestra una vez en el modal** — copiarlo a un gestor de
   contraseñas inmediatamente. Si se pierde, hay que borrar la key y crear una nueva.

### ⚠️ Si redeployás de un Chatwoot vanilla a esta config

Los attachments creados ANTES del switch quedan en el disk local del container `chatwoot`
y se pueden perder al reiniciar/upgradear. Si son críticos, migrarlos manualmente al
bucket de Supabase antes de cambiar las env vars. Si no, los nuevos van bien y los viejos
se degradan gradualmente.

---

## Checklist post-deploy (smoke tests)

Cada vez que cambies la imagen en EasyPanel a un tag nuevo, verificá:

1. **Web service** (`chatwoot`) está corriendo la imagen nueva (EasyPanel → service → "Implementaciones" debería mostrar el tag y la hora de deploy).
2. **Sidekiq service** (`chatwoot-sidekiq`) está corriendo la **misma** imagen. Lección de la sesión inicial: si se queda atrás, el Copilot sigue usando el código viejo en background y los patches del backend (Patch 2) **no aplican**.
3. **Patch 1 (icono):** abrir la sidebar de Chatwoot → el inbox de Evolution muestra el ícono de WhatsApp (no `{}`). Si seguís viendo `{}`, hacé hard refresh (`Cmd+Shift+R`) — el browser cachea agresivamente los assets de Vite.
4. **Patch 2a (Copilot custom_tools):** abrir el Copilot en una conversación del inbox Evolution → pedirle "programá un mensaje a este contacto para las HH:MM hoy diciendo X". En "Mostrar pasos" debería aparecer:
   ```
   Using schedule_message
   Completed schedule_message
   ```
   Si no aparece, el Copilot no está exponiendo el custom_tool → sidekiq quedó con la imagen vieja.
5. **Patch 2b (fecha dinámica):** mismo test anterior. El Copilot debe confirmar con un folio `SCHED-N` y la fecha legible **del año actual**. Si la confirmación o la DB muestran un año pasado (ej. 2023), el patch 2b no se aplicó.

### Verificación rápida en SQL

```sql
-- Ultima programación creada por el Copilot
SELECT id, send_at AT TIME ZONE 'Europe/Madrid' AS send_at_madrid,
       content, scheduled_via, status, sent_at
FROM nodo_scheduled_messages ORDER BY id DESC LIMIT 1;

-- Audit del request: qué mandó el LLM al tool
SELECT created_at, parsed_send_at_raw, parsed_conversation_display_id,
       response_status, response_error, request_body_parsed
FROM nodo_schedule_message_attempts ORDER BY id DESC LIMIT 3;
```

---

## Post-mortem: bugs encontrados durante el setup inicial

Anotados acá para futuros mantenedores (el `schedule_message` involucra 3 capas que tienen que estar coordinadas: Chatwoot ↔ Captain Copilot ↔ Edge Function Supabase).

| # | Capa | Síntoma | Causa raíz | Fix |
|---|---|---|---|---|
| 1 | EF `schedule-message` | "Canal no compatible" en conv. de Evolution | EF hacía `.eq("id", conversation_id)` pero el Copilot pasa el `display_id`; matcheó por casualidad otra conv. (Email) | EF v4: `.eq("display_id", ...)` |
| 2 | `captain_custom_tools.response_template` | Toda respuesta de la EF era "An error occurred" para el LLM, incluso en 200 OK | Template `{{message}}` con `strict_variables: true` en Liquid; el contexto solo tiene `response` y `r` como vars raíz → `UndefinedVariable` → rescatado como error genérico | `{{response.message}}` |
| 3 | LLM (Captain Copilot) | LLM mandaba `send_at` con año 2023 (training cutoff) | El system prompt del Copilot no incluye la fecha actual | Patch 2 (b): `account_id_context` inyecta UTC + Madrid now dinámicamente |
| 4 | `chatwoot-sidekiq` | Patch del backend no aplicaba aunque la imagen web estaba actualizada | El servicio sidekiq se quedó en la imagen vieja (no se redeployó) | Siempre redeployar **ambos** servicios al cambiar imagen |
| 5 | Frontend (Vite assets) | Icono no cambiaba tras deploy aunque el server tenía los bundles correctos | Browser cacheaba JS/CSS agresivamente | Hard refresh (`Cmd+Shift+R`) o flush manual de localStorage/Cache Storage |
| 6 | Sidebar nativa | Tras pasar a build completo (Dockerfile.nodo v4), el inbox Channel::Api volvió a mostrar el icono default (no WhatsApp) | El Patch 1 modificaba `helper/inbox.js` pero la sidebar nativa usa otro mapeo en `components-next/icon/provider.js`. Antes el SED reemplazaba `i-woot-api` en TODOS los assets compilados — al sacar el SED, este archivo quedó sin tocar | Patch 1b: aplicar el cambio tambien en `provider.js` |
| 7 | Active Storage (imágenes incoming WA Cloud + transcripción de audios Evolution) | (a) "Esta imagen ya no está disponible" en la UI aunque la imagen sí llegaba al WhatsApp. (b) Audios incoming de Evolution **nunca se transcribían** aunque la feature `audio_transcriptions` estaba habilitada (los de WhatsApp Cloud sí se transcribían). | `chatwoot` (web) y `chatwoot-sidekiq` corren en containers **separados** con `/app/storage/` local cada uno. Webhook de WA Cloud + procesamiento de mensajes entrantes delegan a Sidekiq, que descarga el archivo y lo guarda en el disk del sidekiq. Después: (a) el web no lo encuentra al servir la imagen → 404, (b) el `Messages::AudioTranscriptionJob` falla silente al leer el blob (solo rescata `Faraday::UnauthorizedError`, otros errores van a dead queue). | Migrar Active Storage de `local` a `s3_compatible` apuntando al bucket `chatwoot-storage` de Supabase (storage compartido entre containers). **Esto resolvió simultáneamente ambos problemas: imágenes y audios** (evidencia: Evolution audios pasaron de 0/11 = 0% pre-fix a 9/9 = 100% post-fix). Ver sección "Configuración de Active Storage" más arriba. |
| 8 | Patch 6 — `Campaign` model + service + quota controller | 422 "Inbox Unsupported Inbox type" al crear cualquier campaign Evolution desde la UI. El form se mostraba (route gated por flag `api_campaign`), `validate_campaign_inbox` rechazaba el record. Mensaje del 422 quedó tapado en el toast porque mi Dialog solo leía `data.message`; lo confirmé via `fetch` directo desde el navegador autenticado. | Asumí que `inbox.inbox_type` para `Channel::Api` devuelve `'Api'` (PascalCase, como `channel_type.demodulize`). En realidad `inbox_type` delega a `channel.name`, y `Channel::Api#name` devuelve `'API'` (UPPER) — distinto patrón al de `Channel::Whatsapp` (`'Whatsapp'`), `Channel::Sms` (`'Sms'`), `Channel::WebWidget` (`'Website'`). | Reemplazar todos los literales `'Api'` por `'API'` en `app/models/campaign.rb` (whitelist, one_off check, dispatcher, 2 validators), `app/services/api/oneoff_campaign_service.rb` y `app/controllers/api/v1/accounts/inboxes/api_campaign_quotas_controller.rb`. Además: mejorar el toast del Dialog para mostrar también `data.error` y caer a `JSON.stringify(data)` si nada matchea — antes ocultaba el error real con el genérico de Axios. Pattern para el futuro: **nunca asumas que `Channel::Foo#name` coincide con la PascalCase de la clase**; verificá el método. |
| 9 | Patch 6 — `Api::OneoffCampaignService#fetch_audience` | Campaign Evolution se procesaba a `completed` pero **0 mensajes enviados** aunque la audiencia (label "suscriptor") era claramente correcta en la UI — el chip violeta aparecía al lado del contacto Tomas. UX engañosa: el card de la campaign dice "Completado" sin distinguir 0 vs N envíos. | En Chatwoot, una "etiqueta" puede vivir en DOS niveles distintos con apariencia visual idéntica: como `taggings.taggable_type='Contact'` (Contact label) o `'Conversation'` (Conversation label). El upstream `Whatsapp::OneoffCampaignService` solo considera Contact labels (`account.contacts.tagged_with(...)`), y Patch 6 originalmente heredaba ese comportamiento. El user razonablemente etiqueta desde la **conversación** (lo más común en flujos comerciales: abrís la conv, le ponés un label, listo) — eso genera tagging de Conversation, no de Contact → fetch_audience devolvía 0. Además, las taggings apuntan a `tags.id` (gema acts_as_taggable_on), NO a `labels.id` (tabla custom de Chatwoot solo para UI): el lookup canónico es `tags.name`. | `fetch_audience` ahora hace UNION de los 2 caminos: (1) `account.contacts.tagged_with(label_titles, any: true)` (contact-level) + (2) join manual via `ActsAsTaggableOn::Tagging` sobre `conversations.contact_id` filtrando por `taggable_type='Conversation', context='labels'`, `tags.name IN (...)`. Validado E2E el 2026-05-15: campaign 5 con label "suscriptor" en conversación de Tomas → 1 nodo_scheduled_message creado → dispatch a Evolution OK en 63s end-to-end. |

---

## Componente externo: Supabase Edge Functions (project `gonodo`)

Los `captain_custom_tools` apuntan a Edge Functions de Supabase (project ref `ntncrklsckzmoaincafs`) que validan, persisten y operan sobre la cola `nodo_scheduled_messages`. **El código de las EFs NO vive en este repo — vive en Supabase. Para modificarlas usar el dashboard o MCP/CLI.**

### Tools del Copilot para mensajes programados

| Custom tool slug | EF Supabase | Operación | HTTP | Validaciones |
|---|---|---|---|---|
| `schedule_message` | `schedule-message` (v6) | Crear futuro | INSERT | account=1, channel_type=Channel::Api, send_at 30s-30d futuro, content 1-4000 chars |
| `list_scheduled_messages` | `list-scheduled-messages` (v1) | Listar/resumir | SELECT | account=1, conversation_display_id pasado |
| `cancel_scheduled_message` | `cancel-scheduled-message` (v1) | Cancelar pending | UPDATE status='cancelled' (race-safe con `eq status=pending`) | Pertenece a la conv, status actual = pending |
| `update_scheduled_message` | `update-scheduled-message` (v1) | Modificar contenido y/o fecha de un pending | UPDATE content y/o send_at | Pertenece a la conv, status = pending, al menos uno de `new_content` o `new_send_at` debe venir, y los que vienen pasan sus validaciones (content 1-4000 chars, send_at 30s-30d futuro). Detecta y descarta valores `{{...}}` no renderizados por Liquid. |

> **Nota:** La EF antigua `reschedule-scheduled-message` (v1) sigue deployada por seguridad pero su custom_tool fue renombrado a `update_scheduled_message`. Threads viejos del Copilot que tengan el slug viejo en su historial pueden confundirse — se recomienda thread nuevo después del rename.

Todas:
- Recuperan la conversación por `display_id`, **NO** por `id` interno.
- Loggean cada attempt en `nodo_schedule_message_attempts` (columna `operation` distingue `create`/`cancel`/`reschedule`).
- Devuelven `{ "ok": true, ..., "message": "texto humano" }` para que el `response_template = {{response.message}}` extraiga el texto que el LLM le pasa al agente.
- Verifican `account_id == 1` (single-tenant).

### Cola y dispatch

- **Tabla `nodo_scheduled_messages`** — la cola de mensajes pendientes (status: `pending` / `sent` / `failed` / `cancelled`).
- **Cron `dispatch-scheduled-messages`** — corre cada 60s, lee `status='pending' AND send_at <= now() AND attempts < 3` y ejecuta el envío vía Evolution API. Los mensajes `cancelled` quedan fuera del filtro y nunca se envían.

### Tabla de auditoría: `nodo_schedule_message_attempts`

Cada request al EF crea una fila con:
- `operation` — `create` / `cancel` / `reschedule` (el `list` no se logea para evitar ruido)
- `request_body_parsed` — qué mandó el LLM (útil para ver si pasa fechas mal, IDs equivocados, etc.)
- `parsed_send_at_raw` — el `send_at` o `new_send_at` recibido antes de validar
- `response_status` + `response_error` — qué devolvió la EF
- `scheduled_id` — FK al row de `nodo_scheduled_messages` afectado (NULL si fue rechazado antes)

Útil para diagnosticar problemas tipo "el Copilot dice que falló pero no veo el row" o "el LLM mandó una fecha del 2023".

---

## Tab Comercial — Nivel B (mini-CRM via Custom Attributes nativos)

En vez de armar un tab dedicado con tabla `oportunidades` y UI custom (Nivel D del
handoff original), arrancamos con un **mini-CRM 100% basado en Custom Attributes
nativos de Chatwoot**. La única pieza custom es la insignia ✓ azul "Cliente
verificado" (Patch 5).

### Los 7 Custom Attributes (account 1, scope `contact_attribute`)

| Display name | `attribute_key` | Type | Valores (si list) |
|---|---|---|---|
| Etapa comercial | `etapa_comercial` | List | Prospecto · Calificado · Propuesta · Negociación · Cierre |
| Título oportunidad | `titulo_oportunidad` | Text | — |
| Fuente del lead | `fuente_lead` | List | Web form · WhatsApp · Email entrante · Llamada entrante · Referido · LinkedIn · Evento · Otro |
| Monto | `monto_oportunidad` | Currency | — |
| Probabilidad de cierre | `probabilidad_cierre` | Percent | — |
| Cierre estimado | `fecha_cierre_estimada` | Date | — |
| Notas comerciales | `notas_comerciales` | Text | — |

Aparecen automáticamente en el panel lateral del contacto en cualquier conversación.
Editables inline por cualquier agent.

### Cómo se replican a cuentas nuevas

Los Custom Attributes son **por cuenta**, no globales. Cuando se cree una cuenta nueva
(día que escalemos a multi-tenant), hay 2 caminos:

- **Manual**: ir a Settings → Custom Attributes y recrearlos (5 min por cuenta).
- **Auto (SQL)**: query para clonar las 7 definitions de account 1 a la cuenta nueva.

```sql
-- Auto-clonar Custom Attributes de account 1 a account N
INSERT INTO custom_attribute_definitions
  (account_id, attribute_model, attribute_display_name, attribute_key,
   attribute_display_type, attribute_description, attribute_values,
   created_at, updated_at)
SELECT
  N AS account_id,
  attribute_model, attribute_display_name, attribute_key,
  attribute_display_type, attribute_description, attribute_values,
  now(), now()
FROM custom_attribute_definitions
WHERE account_id = 1
  AND attribute_key IN (
    'etapa_comercial','titulo_oportunidad','fuente_lead','monto_oportunidad',
    'probabilidad_cierre','fecha_cierre_estimada','notas_comerciales'
  );
```

### Workflow operativo del agente

1. Llega un nuevo contacto (cualquier inbox o creación manual).
2. Abre la conversación → panel lateral → completar:
   - `Etapa comercial` → arranca con "Prospecto"
   - `Fuente del lead` → según origen
   - (opcional) `Título oportunidad`, `Monto`, `Probabilidad`, etc.
3. A medida que avanza la negociación, cambiar `Etapa comercial` paso a paso.
4. Al setear `Etapa comercial = Cierre` → **aparece automáticamente la insignia ✓ azul**
   al lado del nombre del contacto (Patch 5).
5. Si el agent vuelve la etapa hacia atrás, la insignia desaparece (no persiste).

### Limitaciones conocidas (vs Nivel D del handoff original)

- **Sin embudo visual clickeable** (5 dots con animación) — solo dropdown plano del
  Custom Attribute.
- **Sin counters de interacciones** (Llamada/Email/Reunión/WhatsApp +1).
- **Sin auto-cálculo de probabilidad** según etapa — el agent la setea a mano (en
  Nivel C lo podemos automatizar con automation rule).
- **Sin tab separado "Comercial"** — los attributes viven en el panel general del
  contacto.
- **Insignia no persistente**: si la etapa vuelve atrás de "Cierre", la ✓ desaparece.
- **Sin auto-creación de oportunidad**: el agent completa los attributes manualmente.

Cuando estos límites se vuelvan problemáticos en la práctica, escalamos a Nivel C/D.

---

## Patch 6 — Campañas Channel::Api (Evolution)

Add-on premium que permite enviar campañas masivas (one-off) a contactos
filtrados por labels desde inboxes Evolution (`Channel::Api`). Reusa la
infra de `nodo_scheduled_messages` (Patch 2 / Captain Copilot) para el
throttling.

### Reglas de negocio

| Regla | Valor |
|---|---|
| Cap de envío | **200 mensajes / 24h por inbox** (rolling window) |
| Delay entre mensajes | Aleatorio entre **3 y 20 segundos** |
| Audiencia > 200 | **Spread automático** dentro de la misma campaign (los excedentes se programan al siguiente bucket de 24h, y así sucesivamente) |
| Exclusión mutua | **Solo 1 campaign Evolution activa por inbox a la vez**. Otros inboxes (Evolution o de otros canales) NO se ven afectados. |
| Imagen | Opcional, **vía URL pública** en `campaign.template_params['attachment_url']`. Sin upload (v2). |
| Cancelación | Sí — cancelar la campaign marca todos los `nodo_scheduled_messages` pending como `cancelled` |
| Variabilidad de contenido | No (todos reciben el mismo `campaign.message`). Placeholders en v2 si se piden. |

### Activación como add-on premium

El feature flag `api_campaign` está marcado como `premium: true` en
`config/features.yml`. Aparece automáticamente como **checkbox en el panel
de Super Admin de Chatwoot** (`/super_admin/accounts/:id/edit` → sección
"Premium Features").

**Workflow operativo cuando un cliente Nodo paga el addon:**

1. Vos (super admin) entrás a `https://go.otronodo.com/super_admin/accounts/X/edit`
2. Scroll a "Premium Features" → marcar checkbox **"Evolution Campaigns"**
3. Save (~10 segundos total)
4. El cliente recarga su Chatwoot → ve el tab "Evolution" en `/campaigns`

Para desactivar: desmarcar el checkbox. El tab desaparece y el backend
rechaza nuevas campaigns. Las que están en curso siguen ejecutándose
(comportamiento sensato).

**Alternativa por Rails console** (si el checkbox no aparece en el panel
de Super Admin — p.ej. el server aún no reinició tras agregar la entry a
`features.yml`):

```bash
# Desde el host con docker, o EasyPanel terminal del container chatwoot:
docker exec -it chatwoot bundle exec rails runner \
  "Account.find(X).enable_features!('api_campaign')"

# Verificar:
docker exec -it chatwoot bundle exec rails runner \
  "puts Account.find(X).feature_enabled?('api_campaign')"
# => true
```

Chatwoot usa la gem **FlagShihTzu** sobre la columna `accounts.feature_flags`
(bigint bitmask), así que el método `enable_features!` (bang) ya calcula el
bit correcto y persiste. No tocar la columna a mano con SQL — el orden de
los bits depende del orden en que se definen los flags en el modelo y
podés romper otros flags si calculás mal.

### Flow técnico

```
1. Agent crea Campaign en UI Chatwoot (tab Evolution)
   - Inbox: Channel::Api (Evolution)
   - Audience: labels seleccionadas
   - Mensaje + URL imagen (opcional) + scheduled_at
       ↓
2. Campaign#trigger! ejecuta Api::OneoffCampaignService.perform
   - Valida feature flag + tipo inbox + completed
   - Lee audiencia por labels (any: true)
   - Calcula slots usados en rolling 24h del inbox
   - Para cada contacto, calcula send_at con delay 3-20s
   - Si pasa el cap del bucket actual, salta al siguiente bucket
     (cursor += 24h, bucket_count = 0)
   - Crea row en nodo_scheduled_messages con campaign_id
   - Marca campaign.completed!
       ↓
3. Cron EF `dispatch-scheduled-messages` (cada 60s)
   - SELECT pending WHERE send_at <= now()
   - Despacha vía Evolution API (sendText o sendMedia si attachment_url)
   - Marca status = sent
```

### Endpoint de quota (frontend)

`GET /api/v1/accounts/:account_id/inboxes/:inbox_id/api_campaign_quota`

```json
{
  "feature_enabled": true,
  "inbox_type_supported": true,
  "daily_cap": 200,
  "rolling_window_hours": 24,
  "slots_used": 120,
  "slots_available": 80,
  "next_slot_available_at": null,
  "active_campaign": null
}
```

El frontend lo poll cada 30s para mostrar:
- "Te quedan 80 mensajes en las próximas 24h"
- Botón "Nueva campaña" deshabilitado si `active_campaign` no es null

### Limitaciones conocidas (MVP)

- ❌ Sin upload de archivo (solo URL pública para imágenes)
- ❌ Sin placeholders en el mensaje (`{{contact.name}}`)
- ❌ Sin múltiples archivos por campaign (1 imagen opcional)
- ❌ Sin scheduling repetitivo (cada lunes 9am)
- ❌ Sin A/B testing de mensajes
