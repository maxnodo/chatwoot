# Mensajes programados con visibilidad total en la bandeja

> **Programá un envío para "mañana a las 9", olvidate del recordatorio en
> tu calendario, y mantené a todo tu equipo informado de qué le va a
> llegar a cada contacto y cuándo. Sin doble agenda, sin contradicciones,
> sin mensajes duplicados.**

---

## El problema que resolvemos

Cualquier equipo comercial tiene esta escena al menos una vez por día:

> *Agente A:* "Le prometí a Juanpe mandarle la propuesta el lunes a las 10."
>
> *Agente B (lunes 9:30):* "Hola Juanpe, te dejo la propuesta..."
>
> *Agente A (lunes 10:00):* "Hola Juanpe, te dejo la propuesta..."
>
> **Juanpe ve dos mensajes idénticos en 30 minutos y queda confundido.**

O esta otra:

> *Agente:* "Le prometí a María llamarla el jueves a las 16."
>
> *(jueves 16:00 — el agente está en otra reunión)*
>
> *(jueves 18:00 — el agente vuelve y dice "ay, me olvidé")*
>
> **María se sintió ignorada. La oportunidad se enfrió.**

El problema de fondo es el mismo: **la memoria del equipo no escala**. Lo
que un agente promete por teléfono o por chat se queda en su cabeza, y
nadie más del equipo sabe que ese compromiso existe.

---

## La solución: Mensajes programados visibles para todo el equipo

Tu CRM Nodo te permite **programar mensajes en el futuro** y, lo más
importante, **ver en tiempo real desde la bandeja de conversaciones qué
contactos tienen envíos pendientes y cuándo van a llegar**.

Tenés 2 formas de programar un mensaje:

### Forma 1: Con el Asistente IA (recomendado)

Estás en una conversación con un cliente y le decís al asistente:

> *"Programá un mensaje a este contacto para mañana a las 9:30 que diga:
> Hola, ¿pudiste revisar la propuesta?"*

El asistente entiende, valida que el contacto sea de WhatsApp Evolution,
confirma la hora con vos, y programa el envío. **A las 9:30 del día
siguiente el mensaje sale solo.**

### Forma 2: Con campañas (si querés mandar a varios contactos)

Para envíos masivos a 10+ contactos, usás el módulo de **Campañas
Evolution** (ver doc separado). Cada campaña crea automáticamente todos
los mensajes programados a futuro.

---

## Lo que vas a ver en la bandeja

Esta es la parte que hace la diferencia. **Cada conversación que tiene
mensajes programados pendientes muestra un chip violeta** al lado del
nombre del contacto:

```
Facundo Petrucelli  🕐 1 programado · en 2d
↪ 🎧 Mensaje de audio
```

De un vistazo, todo el equipo ve:
- **Quién** tiene mensajes pendientes
- **Cuántos** mensajes
- **En cuánto tiempo** sale el próximo

Si tu vista tiene 50 conversaciones abiertas, sabés instantáneamente
cuáles tienen "compromisos a futuro" y cuáles no.

---

## Cuando abrís la conversación

Encima del thread de mensajes aparece un **banner detallado** con todos
los programados pendientes:

```
┌────────────────────────────────────────────────────────────┐
│ 📅  1 mensaje programado  próximo 18 may · 09:00 · en 1 día ▾│
└────────────────────────────────────────────────────────────┘
```

Antes de escribirle al cliente, **el agente ve qué le va a llegar y
cuándo**. Esto previene:

- **Mensajes duplicados** (no le decís lo mismo que ya tiene programado)
- **Mensajes contradictorios** (no le decís A si en 1h le va a llegar B)
- **Olvido de seguimiento** (si vos no respondés, el programado lo hace
  por vos)

Click en el chevron `▾` y el banner se expande mostrando todos los
detalles:

```
┌─────────────────────────────────────────────────────────────┐
│ 18 MAY   🔔 Recordatorio                          ✏️   ❌  │
│ 09:00    Recordatorio: Tienes una reunión hoy a las 10...   │
│ en 1 día                                                     │
└─────────────────────────────────────────────────────────────┘
```

Cada item muestra:
- **Fecha y hora exacta** del envío
- **Distancia desde ahora** ("en 1 día", "en 30 min", "ahora")
- **Tipo** (recordatorio manual o nombre de campaña)
- **Preview del contenido** que va a salir

---

## Acciones rápidas: cancelar lo programado

Si las circunstancias cambian (el cliente ya respondió, la promo se
canceló, etc.), un administrador puede **cancelar el envío** con un click
del icono ❌ en cada item del banner. El sistema:

1. Pide confirmación rudimentaria
2. Marca el mensaje como cancelado (no lo borra — queda auditoría)
3. Quita el chip de la bandeja inmediatamente
4. El envío **no se ejecuta** en su horario

Esto es clave porque permite **corregir errores antes de que lleguen al
cliente**. Si el agente A programó algo y el agente B se entera de que
era incorrecto, lo cancela sin esperar a un manager.

---

## Casos de uso típicos

### Seguimiento comercial automatizado
*"Hola {{nombre}}, ¿pudiste revisar la propuesta que te mandé el viernes?"*
programado para 3 días después del envío inicial. Si el cliente respondió
en ese plazo, lo cancelás. Si no, sale solo y mantenés el contacto vivo.

### Recordatorio de reunión / cita
*"Te recordamos que tenemos reunión mañana a las 14:00. Acá va el link de
Meet..."* programado para 24 horas antes. Reduce drásticamente los
no-shows.

### Reminder de pago / vencimiento de suscripción
*"Tu suscripción vence el {{fecha}}. Renová ahora con un click..."*
programado para 3 días antes del vencimiento. Mejor cobranza, sin
hostigar.

### Mensaje de bienvenida automático
Cuando entra un contacto nuevo, programás *"Hola {{nombre}}, gracias por
contactarnos. Te respondemos en menos de 24h."* para que salga 5
segundos después. El cliente siente respuesta inmediata aunque el equipo
esté ocupado.

### Onboarding multistep
Para clientes que firman, programás 4-5 mensajes de onboarding:
- Día 1: bienvenida
- Día 3: tutorial inicial
- Día 7: check-in
- Día 14: feedback

Todo queda visible para el equipo en la bandeja del cliente. Si alguien
del equipo lo agarra antes y le da soporte, puede cancelar el siguiente
mensaje programado para no parecer impersonal.

---

## Diferenciadores vs herramientas externas

### Vs n8n / Zapier
Las herramientas de automatización externas **no tienen visibilidad
desde el CRM**. El agente no ve qué le va a llegar al cliente sin entrar
a otra plataforma. Acá todo está en la misma bandeja.

### Vs Calendario tradicional
Programar en Google Calendar "mandarle un mensaje a Juanpe el lunes"
**te recuerda a vos**, pero no manda nada solo. Sigue requiriendo que un
humano esté disponible exactamente en ese momento.

### Vs Recordatorios manuales en el CRM
Un recordatorio "esta conversación necesita un follow-up" te avisa que
algo está pendiente, pero **no manda nada solo**. Nosotros mandamos el
mensaje real, no solo el aviso.

### Vs Mass Mailers / Email schedulers
Email scheduling ya existe en muchas herramientas, pero **WhatsApp
scheduling con visibilidad para todo el equipo desde el CRM no**. Eso
es lo único de este módulo.

---

## Diferenciación según el origen del mensaje

El sistema **distingue visualmente** entre mensajes programados manuales
(que un agente programó conversando con el asistente IA) y los que vienen
de una campaña masiva:

| Origen | Icono | Caso típico |
|---|---|---|
| **Manual** (Copilot) | `🔔` | Seguimiento puntual a un contacto |
| **Campaña** | `📢` | Promo, anuncio, comunicación masiva |

Cuando un agente abre una conversación, sabe inmediatamente si lo que va
a llegarle es algo personal que él prometió, o algo de una campaña
general. Eso cambia cómo responde si decide intervenir antes.

---

## Cómo funciona técnicamente (resumen no-técnico)

1. **Vos programás** (con IA o desde una campaña) → se guarda en una
   cola interna del sistema.
2. **Cada minuto**, un proceso revisa la cola buscando mensajes "que
   ya tienen que salir".
3. **Cuando encuentra uno**, lo manda al WhatsApp del destinatario, lo
   guarda como mensaje saliente en la conversación, y lo marca como
   "enviado".
4. **El indicador en la bandeja se actualiza automáticamente** cada 60
   segundos. Cuando un programado sale, el chip baja de 2 a 1, o
   desaparece.

Si por algún motivo el envío falla (WhatsApp del cliente caído, número
de teléfono inválido, etc.), el sistema **reintenta hasta 3 veces** con
espera entre intentos. Si los 3 fallan, queda registrado el error para
revisión manual.

---

## Preguntas frecuentes

**¿Puedo programar un mensaje a horarios distintos para cada destinatario?**
Sí, si lo hacés a través de campañas: el sistema distribuye los envíos
con un delay aleatorio de 3-20 segundos entre cada uno (no llegan todos a
la misma hora exacta).

**¿Y si el cliente me responde antes de que salga el programado?**
Eso es una decisión humana: el agente puede cancelar el programado desde
el banner antes de que llegue. No se cancela automáticamente porque a
veces querés que llegue igual.

**¿Quién puede cancelar programados?**
Solo administradores. Los agentes ven el banner y los items pero no
tienen el botón ❌. Esto evita que se cancele algo importante por
accidente.

**¿Hay límite de mensajes programados al futuro?**
Cada inbox respeta el cap de 200 mensajes/24h. Si querés programar 1000
mensajes, el sistema los va a distribuir automáticamente en los próximos
días.

**¿Se ve el indicador en la bandeja para todos los miembros del equipo?**
Sí. Cualquier agente que tenga acceso a la conversación ve el chip y el
banner. Es info operativa, no admin-only.

**¿Cuánto tarda en aparecer un nuevo programado en la bandeja?**
Hasta 60 segundos (es el intervalo de actualización del indicador). Si
querés ver el cambio inmediato, refrescá la página.

**¿Puedo programar mensajes para WhatsApp Cloud (no Evolution)?**
Por ahora, solo para inboxes Evolution. WhatsApp Cloud está en backlog.

---

## Datos clave para social proof

- **3 niveles de visibilidad**: bandeja (resumen), conversación (banner),
  panel de contacto (futuro)
- **2 orígenes diferenciados**: manual del Copilot 🔔 vs campaña 📢
- **60 segundos** de polling automático (cero clicks necesarios)
- **3 reintentos** automáticos si un envío falla
- **Cancel inline** sin salir de la conversación (admin-only)
- **Auditoría completa** — los cancelados quedan registrados, no se borran

---

## Llamada a la acción

¿Tu equipo gestiona seguimientos manualmente con calendar/post-its?
¿Tenés casos donde dos personas le escribieron lo mismo al mismo cliente
con minutos de diferencia? Estos son los síntomas exactos que el módulo
de Mensajes Programados resuelve.

Hablalo con tu referente Nodo para activarlo. Está incluido en el
asistente IA del CRM — si ya lo tenés, **ya tenés esto andando**.
