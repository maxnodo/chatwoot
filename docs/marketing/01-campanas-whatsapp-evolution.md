# Campañas de WhatsApp nativas en tu CRM

> **Lanzá comunicaciones masivas a tus contactos sin quemar tu número, sin
> herramientas externas, sin migrar de plataforma. Todo desde el mismo CRM
> donde ya gestionás tus conversaciones.**

---

## El problema que resolvemos

Si tenés WhatsApp Business y querés mandar promociones, recordatorios o
anuncios a 50, 100 o 200 contactos al mismo tiempo, hoy estás eligiendo
entre tres caminos malos:

1. **Copiar y pegar uno por uno** — agota a tu equipo y no escala.
2. **Usar "blasters" o herramientas externas** tipo Bulk Sender — mandan
   100 mensajes en 5 minutos y a la semana tu número aparece **suspendido
   por Meta**. Perdés el contacto con tus clientes y tenés que arrancar
   con un número nuevo.
3. **Pagar WhatsApp Business API oficial de Meta** — caro, lento de
   aprobar, te obliga a usar templates pre-aprobados (sin libertad
   creativa), y los precios escalan rápido cuando crecés.

Ninguna de las opciones te permite **mandar comunicaciones masivas seguras
y personalizadas desde el mismo lugar donde respondés conversaciones**.

---

## La solución: Campañas Evolution nativas en tu CRM

Sumamos un módulo de **Campañas para WhatsApp Evolution** directamente
dentro de tu CRM Nodo (basado en Chatwoot). Sin herramientas externas, sin
migrar contactos, sin templates de Meta. Funciona así:

1. **Vas al tab "Campañas → Evolution"** en el menú lateral
2. **Hacés click en "Crear campaña"**
3. **Elegís audiencia por etiqueta** (ej. todos los contactos con label
   "clientes-2025" o "interesados-curso")
4. **Escribís un mensaje libre** — texto, emojis, links — opcionalmente
   con personalización por contacto (ver más abajo)
5. **Opcionalmente, sumás una imagen** pegando una URL pública
6. **Programás el envío** para hoy a la tarde, mañana a las 9 AM o cuando
   quieras
7. **Listo.** El sistema se encarga del resto.

Mientras dormís, el CRM va mandando los mensajes **uno por uno**,
**respetando un ritmo natural**, **sin que tu número quede comprometido**.

---

## ¿Por qué tu número NO se va a banear?

Esto es lo que nos diferencia de cualquier "blaster" del mercado. Tenemos
**4 controles automáticos** que replican el comportamiento humano:

### 1. Cap de 200 mensajes / 24 horas por número

Meta detecta volumen anormal cuando ve más de 250-300 envíos por día
desde un número. Nosotros frenamos en 200 — el umbral donde un usuario
muy activo en WhatsApp opera, indistinguible de un humano que escribe
mucho.

### 2. Delay aleatorio de 3 a 20 segundos entre cada mensaje

Los blasters disparan a velocidad constante (1 mensaje cada 2 segundos)
— Meta los detecta inmediatamente. Nosotros usamos un intervalo
**aleatorio**: a veces 3s, a veces 17s, a veces 8s. Patrón estadístico de
una persona escribiendo, no de un bot.

### 3. Spread automático si tu audiencia es grande

¿Querés mandarle a 500 contactos? Sin problema. El sistema **distribuye
automáticamente** los primeros 200 en las próximas 24h, los siguientes
200 al día siguiente, y los restantes al tercer día. Vos creás **una
sola campaña** y el sistema se ocupa de extenderla en tiempo.

### 4. Una campaña activa por vez (por número)

Si ya tenés una campaña corriendo, el sistema **te impide arrancar otra
en paralelo** en el mismo número. Evita que dos campañas se solapen y
generen un burst de mensajes que rompa el cap.

**Resultado:** Tu WhatsApp Business sigue funcionando como siempre, tus
contactos te responden, y vos no perdés horas armando workarounds para
no caer en spam.

---

## Personalización por contacto (sin templates de Meta)

Cada mensaje puede llevar **variables que se reemplazan automáticamente**
con datos de cada contacto. Esto no solo hace el mensaje más cercano —
también reduce todavía más el riesgo de detección, porque Meta penaliza
mensajes idénticos enviados en masa.

Variables disponibles:

| Variable | Se reemplaza por |
|---|---|
| `{{nombre}}` | Primer nombre del contacto (ej. "Juanpe") |
| `{{nombre_completo}}` | Nombre completo (ej. "Juanpe Vázquez") |
| `{{empresa}}` | Empresa del contacto si está cargada |
| `{{email}}` | Email del contacto |
| `{{telefono}}` | Teléfono del contacto |

Si un contacto no tiene cargado el campo, usamos un **fallback sensato**
(ej. `{{empresa}}` vacía → "tu empresa"), así el mensaje siempre queda
natural.

**Ejemplo:**

Escribís en el form:
> Hola {{nombre}} 👋
> Te tenemos una novedad para {{empresa}}: ya está disponible la nueva
> versión del CRM. ¿Charlamos cuando tengas un rato?

A cada contacto le llega su versión personalizada:

- A Juanpe (empresa "Acme SRL"): *"Hola Juanpe 👋  Te tenemos una novedad
  para Acme SRL..."*
- A Daiana (sin empresa cargada): *"Hola Daiana 👋  Te tenemos una novedad
  para tu empresa..."*
- A Tomas (empresa "Nodo VE"): *"Hola Tomas 👋  Te tenemos una novedad
  para Nodo VE..."*

**Tres mensajes distintos → tres "huellas" distintas → Meta los clasifica
menos como broadcast masivo.** Las variables son **opcionales**: si no las
usás, el mensaje sale igual a todos (como antes).

---

## Indicador en tiempo real de cuántos mensajes te quedan

Cuando creás una campaña, el formulario te muestra **en vivo** cuántos
slots tenés disponibles en tu inbox:

> "Te quedan 137 mensajes disponibles en las próximas 24h (63/200 usados)."

Si ya hay una campaña activa, el botón "Crear" queda **deshabilitado** con
un mensaje claro: *"Ya hay una campaña activa en este inbox: 'Promo Mayo'
(45 mensajes pendientes). Esperá a que termine para crear otra."*

Cero adivinanzas. Cero envíos accidentales que rompan el cap.

---

## Casos de uso típicos

### Lanzamiento de promo flash
*"Solo hoy hasta las 18 hs — 20% off en todos los productos. Usá el código
PROMO20."* a tu segmento de "clientes-frecuentes" (87 contactos).

→ La campaña arranca a las 09:00, termina alrededor de las 13:00 (87
mensajes × ~12 segundos promedio). Cada contacto recibe el mensaje **una
sola vez** y tiene toda la tarde para usar la promo.

### Recordatorio de pago / vencimiento
*"Hola {{nombre}}, te recordamos que tu suscripción {{empresa}} vence
mañana. Acá te dejo el link para renovar..."* a "clientes-vencen-este-mes"
(120 contactos).

→ Personalizado por contacto, no parece broadcast, mejor conversión que
un email genérico.

### Invitación a evento / webinar
*"Hola {{nombre}}, ¿confirmás que venís al webinar del jueves a las 19hs?
Te mando el link unas horas antes."* a "interesados-curso" (50 contactos).

→ Quien responde "sí" pasa a un funnel de seguimiento. Quien no responde
queda con un toque suave sin parecer spam.

### Reactivación de clientes inactivos
*"Hola {{nombre}}, hace 3 meses que no te veíamos por acá. Te dejamos
esto..."* a "no-compra-90-dias" (200 contactos exactos).

→ Una sola campaña, se distribuye en 1 día completo. Conversión típica
del 5-15% en reactivación.

---

## ¿Cómo se compara con otras herramientas?

| Característica | Blasters (Bulk Sender) | Meta WhatsApp Business API | **Nodo Campañas Evolution** |
|---|---|---|---|
| Riesgo de ban del número | 🔴 Alto | 🟢 Ninguno | 🟢 Mínimo (controles anti-detection) |
| Texto libre (sin templates) | ✅ | ❌ (templates pre-aprobados) | ✅ |
| Imagen / archivos | ✅ | ✅ | ✅ (vía URL pública) |
| Personalización por contacto | ⚠️ Limitada | ✅ (con limits) | ✅ |
| Programación | ⚠️ Básica | ✅ | ✅ |
| Integrado con tu CRM | ❌ | ⚠️ Vía integraciones | ✅ Nativo |
| Setup | Inmediato | Aprobación 2-4 semanas | Inmediato |
| Pricing | Bajo, riesgoso | Alto, escala con uso | Add-on al CRM (1 pago) |

---

## Activación

Las Campañas Evolution son un **add-on premium** del CRM Nodo. Se activa
en menos de 1 minuto desde el panel de administración una vez que confirmás
el upgrade.

Una vez activado, tu equipo ve el nuevo tab **Campañas → Evolution** en
el menú lateral y puede empezar a crear campañas inmediatamente.

---

## Preguntas frecuentes

**¿Necesito un número de WhatsApp Business nuevo?**
No. Funciona con el mismo número que ya estás usando en el CRM, mientras
sea Evolution API.

**¿Y si quiero mandar a más de 200 contactos?**
Sin problema. El sistema distribuye automáticamente: 200 hoy, 200 mañana,
y así. Una sola campaña, los contactos reciben todos.

**¿Puedo cancelar una campaña en curso?**
Sí. Desde el detalle de la campaña podés marcarla como cancelada y los
mensajes pendientes no se envían.

**¿Qué pasa si un contacto no tiene cargado `{{empresa}}` (u otro campo)?**
Usamos un fallback sensato. `{{empresa}}` vacía → "tu empresa". El
mensaje queda natural siempre.

**¿Veo qué mensajes salieron y a quién?**
Sí. Cada envío queda registrado como mensaje saliente en la conversación
del contacto correspondiente, igual que si lo hubieras escrito vos.

**¿Puedo mandar la misma campaña a la misma audiencia dos veces?**
Sí, pero el sistema te avisa para que confirmes (evita envíos duplicados
por error).

**¿Cuánto tarda en arrancar a enviar después de crear la campaña?**
Si programaste a "ahora + X minutos", arranca a la hora indicada con
margen de ~1 minuto. Si es muy futuro, se respeta exactamente el horario.

---

## Datos clave para social proof

- **200 mensajes/24h** por número (cap protectivo)
- **3-20 segundos** de delay aleatorio entre envíos
- **5 variables** de personalización por contacto
- **0 templates** requeridos (texto libre total)
- **1 paso** para activar (panel de admin)
- **Cero migración** — usa tus contactos y etiquetas existentes

---

## Llamada a la acción

¿Querés sumar Campañas Evolution a tu cuenta Nodo? Hablalo con tu
referente y lo activamos en el día. Una vez prendido, el equipo arranca
con su primera campaña en menos de 10 minutos sin training adicional.
