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
