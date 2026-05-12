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
| 1 | `app/javascript/dashboard/helper/inbox.js` | Icono `Channel::Api` muestra logo de WhatsApp en la sidebar (en lugar del corchete `{}` default). |
| 2 | `enterprise/app/services/captain/copilot/chat_service.rb` | El Copilot expone los `captain_custom_tools` del account al modelo (Chatwoot v4.13.0 solo los expone al Captain Assistant, no al Copilot). |

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
| `docker/Dockerfile.nodo` | Imagen custom basada en `chatwoot/chatwoot:v4.13.0` + COPY de los archivos parcheados. |
| `.github/workflows/build-nodo-image.yml` | CI/CD que builda y publica la imagen en GHCR. |
| `README_NODO.md` | Este documento. |
