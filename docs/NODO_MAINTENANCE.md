# Mantenimiento de Nodo — 16 de septiembre de 2026

## Fuentes y alcance

Repositorio `maxnodo/chatwoot`, rama productiva `nodo-customizations`. Esta actualización integra upstream `v4.17.1` y conserva los patches Nodo. SumUp permanece aparcado; su stash original no se aplicó. Las funciones SumUp se exportan como inventario, sin modificarlas ni desplegarlas.

La base del CRM es Supabase `gonodo` (`ntncrklsckzmoaincafs`). Incluye también funciones de otros proyectos: no desplegar masivamente todas las carpetas. Código canónico exportado desde producción: 16 Edge Functions en `supabase/functions`, configuración JWT en `supabase/config.toml` y 10 migraciones históricas. Las migraciones Rails siguen en `db/migrate`. El historial Supabase exportado no sustituye un dump completo: hubo objetos creados fuera de ese historial.

## Cambios aplicados a Supabase

- Cuentas 1, 20 y 25: se trasladó el flag Evolution de 32 a 64 conservando cualquier otro bit. Se retiró `delayed_automations`, activado accidentalmente por el desplazamiento. La cuenta 17 no cambió.
- Tres tablas nuevas (`automation_rule_pending_executions`, `conversation_outcomes`, `campaign_recipients`): RLS habilitado, sin políticas de cliente, y privilegios retirados a PUBLIC/anon/authenticated. Acceso por Rails y service_role sigue siendo interno. Los defaults de tablas/secuencias creadas por postgres retiran permisos de anon/authenticated.
- Dos funciones trigger SECURITY DEFINER dejan de ser ejecutables por clientes; cuatro funciones trigger fijan su search_path.
- Los dos cron ahora envían un secreto de Vault en `x-nodo-dispatch-token`. El secreto no está en Git ni escrito literalmente en cron.job.
- `dispatch-scheduled-messages` v9 y `dispatch-group-messages` v2 validan ese secreto mediante un RPC restringido a service_role. `verify_jwt=false` es intencionado: se usa autenticación propia.
- Cada mensaje se reserva mediante UPDATE condicional `pending -> processing` antes de enviarse. Solo un trabajador obtiene la fila; la cancelación previa gana la carrera. El intento se cuenta en la reserva.
- Fallos de transporte ambiguos terminan en failed/error para revisión manual, sin reenvío automático. Una ejecución interrumpida puede dejar processing: tampoco se reintenta automáticamente. Antes de reponer pending hay que comprobar si el proveedor ya entregó el mensaje.
- El dispatcher individual verifica que cuenta, inbox y conversación coincidan.

## Verificaciones realizadas

- 48 pruebas existentes del frontend: filtros, automatizaciones y cookies del SDK.
- 7 pruebas Deno con HTTP simulado: autorización válida/inválida, concurrencia, cancelación y fallo de red en ambos despachadores. No envían mensajes externos.
- Las llamadas sin secreto a ambos endpoints desplegados devuelven 401.
- Los cron autenticados mantienen respuestas HTTP 200.
- Flags y permisos comprobados por SQL; Advisor ya no devuelve los 3 ERROR de RLS ni los avisos de funciones abiertas/search_path.
- La restauración del esquema public del backup en PostgreSQL 17 aislado terminó sin errores: 4 cuentas, 24.564 mensajes y 118 programados en el corte del backup. La migración de permisos se ejecutó allí antes de producción.

Comandos de pruebas:

```sh
pnpm test app/javascript/dashboard/helper/specs/filterQueryGenerator.spec.js app/javascript/dashboard/composables/spec/useEditableAutomation.spec.js app/javascript/sdk/specs/cookieHelpers.spec.js
npx deno test --config supabase/deno.json --allow-env --lock=supabase/deno.lock supabase/tests/dispatch_test.ts
```

## Backup y recuperación

Backup previo en el VPS: `/root/nodo-backups/20260916/`, acceso root. Copia local privada: `/Users/maximilianoleguizamon/Documents/Nodo/maintenance-20260916/`. No añadir backups al repositorio: contienen datos de clientes y configuración sensible.

`gonodo.dump` es un archivo pg_dump custom de Postgres 17; `restore-list.txt` registra el inventario. `easypanel.tgz` y `services.json` guardan la configuración anterior. Storage se copia por separado con un manifiesto de claves, tamaños y SHA-256. La DB por sí sola no recupera los archivos de Storage.

Imagen anterior: `ghcr.io/maxnodo/chatwoot:v4.17.0-nodo.78`. Cambiar ambas imágenes desde EasyPanel si hace falta rollback. No usar docker service update por fuera del panel. La migración de 4.17.1 agrega `conversations.ai_assignee_type` y rellena AgentBot; no retirar esa columna automáticamente al volver a 4.17.0. Los flags de Evolution permanecen en 64, porque ambas versiones 4.17.0/4.17.1 usan ese valor.

El backup completo se restaura primero en un entorno aislado; una restauración de producción requiere planificar el corte y la pérdida de cambios posteriores al backup. Para recuperación dentro de Supabase deben preservarse sus schemas/roles administrados. La prueba de restauración realizada cubre las tablas de negocio public, no una reconstrucción completa de todos los servicios administrados de Supabase.

## Checklist de cada actualización

1. Confirmar backup DB y adjuntos, configuración EasyPanel y tag anterior.
2. Crear worktree por tarea; revisar diferencias upstream y conservar todos los patches frente al tag nuevo.
3. Comparar orden de feature flags: un cambio de orden exige migrar valores conservando bits ajenos.
4. Leer migraciones Rails, probarlas con una restauración aislada y ejecutar pruebas relevantes.
5. Compilar imagen candidata sin sobrescribir latest; validar antes de desplegar.
6. Publicar y desplegar web + Sidekiq desde EasyPanel con la misma imagen.
7. Comprobar versión, salud, migraciones, bandejas, cuotas, indicadores, Copilot y configuración de audio/pagos. Los pagos y envíos reales requieren una prueba controlada específica.
8. Ejecutar Advisor y revisar permisos de tablas nuevas, propietarios y default privileges; comprobar ambos cron y mensajes processing detenidos.
9. Guardar nuevas migraciones/funciones y el resultado de las comprobaciones en Git.

Consulta operativa para detectar reservas interrumpidas:

```sql
SELECT id, status, attempts, updated_at
FROM public.nodo_scheduled_messages
WHERE status = 'processing' AND updated_at < now() - interval '10 minutes';
SELECT id, status, attempts, updated_at
FROM public.nodo_scheduled_group_messages
WHERE status = 'processing' AND updated_at < now() - interval '10 minutes';
```

## Límites y decisiones pendientes

- El bucket de adjuntos sigue público; cambiar su modelo requiere comprobar URLs y flujos de Active Storage. No forma parte de esta actualización.
- Tres extensiones continúan en public (pg_trgm, vector, pg_net). Moverlas puede afectar tipos/consultas de Rails y servicios administrados; no se cambian para silenciar un aviso.
- RLS sin políticas en las tres tablas privadas es intencionado: deniega clientes; el Advisor puede mostrar avisos informativos.
- No se amplió la programación por Copilot fuera de la cuenta 1.
- No se enviaron mensajes reales ni se realizaron cobros como parte del mantenimiento.
