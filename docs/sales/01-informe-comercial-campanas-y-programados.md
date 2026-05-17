# Informe comercial — Campañas WhatsApp + Mensajes Programados IA

> **Para el equipo comercial de Nodo.** Este documento te prepara para
> pitchear las nuevas capacidades del CRM, manejar objeciones y cerrar
> upgrades en menos de 20 minutos por reunión.

**Última actualización:** 17 de mayo de 2026
**Status:** ambas capacidades en producción y disponibles para activar

---

## TL;DR — Lo que tenés que saber en 30 segundos

El CRM Nodo (basado en Chatwoot extendido) ahora ofrece **dos
capacidades premium** que ningún CRM low-cost del mercado tiene
integradas:

1. **Campañas WhatsApp Evolution** — envíos masivos seguros sin riesgo
   de ban, con personalización por contacto, cap de 200/24h y delay
   aleatorio anti-detection.
2. **Mensajes programados con IA** — el agente le dice al asistente
   "programá un mensaje para mañana a las 9" y se ejecuta solo. Toda
   la bandeja muestra qué hay programado y para quién.

Ambas son **add-ons premium activables en 1 click** desde el panel de
administración. No requieren WhatsApp Business API oficial. Cero
migración. Cero training adicional para el equipo.

---

## Capacidad 1: Campañas WhatsApp Evolution

### Qué hace en 1 frase
**Permite a tu cliente mandar promociones, recordatorios y comunicaciones
masivas a 200+ contactos por día directamente desde su CRM, sin que su
número de WhatsApp termine baneado.**

### El cliente ideal para esta capacidad

Vendésela a:
- **Comercios con base de clientes 100+** que mandan comunicaciones
  recurrentes (promociones, novedades, recordatorios).
- **Servicios profesionales** que comunican vencimientos, agenda,
  novedades a clientes (consultorios, abogados, estudios contables).
- **E-commerce / cursos online** que ya usan WhatsApp para soporte y
  quieren convertir más con promos.
- **Inmobiliarias, concesionarias, agencias** que mandan alertas masivas
  ("nueva propiedad en tu zona", "nuevo modelo disponible").
- **Cualquier negocio que hoy está usando "blasters" externos y tiene
  miedo de que le baneen el número.** Estos son cierres rápidos: ya
  sienten el dolor.

NO lo vendas a:
- Clientes que mandan 1-5 mensajes manuales por día (no lo van a usar).
- Clientes con menos de 50 contactos en su base (overkill).
- Clientes que SÍ pueden pagar WhatsApp Business API oficial de Meta y
  ya tienen flujos automatizados ahí (es otro tipo de cliente).

### Diferenciador clave que tenés que repetir 3 veces

**"Mandás 200 mensajes por día, pero el sistema los distribuye con un
delay aleatorio entre 3 y 20 segundos, simulando comportamiento humano.
Eso es la diferencia entre que tu número siga funcionando o que Meta te
banee en 48 horas."**

Frase clave para subrayar: **"3 a 20 segundos aleatorio"** — los blasters
mandan a velocidad constante (1 cada 2s) y Meta los detecta. Nosotros no.

### Las 4 protecciones automáticas que tenés que conocer

| # | Protección | Qué hace | Por qué importa al cliente |
|---|---|---|---|
| 1 | **Cap 200/24h por número** | Limita envíos a 200 cada 24 horas | Meta considera spam >250-300/día. Volamos por debajo |
| 2 | **Delay 3-20s aleatorio** | Espaciado natural entre envíos | Distingue humano de bot. Anti-fingerprint |
| 3 | **Spread automático** | Si querés mandar a 500, los reparte en 3 días | Cliente no se preocupa por gestionar el cap manual |
| 4 | **Exclusividad por inbox** | Solo 1 campaña activa por número a la vez | Evita que se solapen y rompan el cap |

### Las 5 variables de personalización

| Variable | Reemplaza por | Caso típico |
|---|---|---|
| `{{nombre}}` | Primer nombre | "Hola Juanpe" |
| `{{nombre_completo}}` | Nombre completo | "Hola Juanpe Vázquez" |
| `{{empresa}}` | Empresa | "para Acme SRL" |
| `{{email}}` | Email | "mandamos detalles a juan@..." |
| `{{telefono}}` | Teléfono | (poco usado, está disponible) |

**Argumento técnico de venta**: cuando 200 mensajes tienen 200 textos
distintos (gracias a las variables), Meta no los puede clasificar como
broadcast idéntico. Es como si cada uno fuera una conversación
individual. **Reduce el riesgo de detección dramáticamente.**

---

## Capacidad 2: Mensajes Programados con IA

### Qué hace en 1 frase
**El agente le dice al asistente IA del CRM "programá un mensaje a este
contacto para mañana a las 9:30", y el mensaje se envía solo en ese
horario. Todo el equipo ve en la bandeja qué contactos tienen envíos
pendientes y cuándo.**

### El cliente ideal para esta capacidad

Vendésela a:
- **Equipos de venta consultiva** que prometen "te mando la propuesta el
  jueves" y a veces se olvidan. El sistema lo hace por ellos.
- **Servicios con recordatorios** (cita médica, reunión, vencimiento de
  cuota). Reduce no-shows del 25-30% a menos del 10%.
- **Equipos con varios agentes en la misma cuenta** que tienen
  "memoria distribuida" y a veces le hablan al mismo cliente dos veces.
- **Cualquier cliente que ya usa el asistente IA del CRM** — esto se
  activa automáticamente como una habilidad nueva del asistente.

### Diferenciador clave que tenés que repetir 3 veces

**"No es un calendar que te recuerda. No es un email schedule. Es
WhatsApp scheduling con visibilidad para todo el equipo desde la
bandeja. Cuando un agente abre una conversación, ve en violeta qué le va
a llegar al cliente. Cero contradicciones, cero mensajes duplicados,
cero olvidos."**

Frase clave: **"Visibilidad para todo el equipo desde la bandeja"** —
eso es lo que ninguna otra herramienta hace.

### Las 3 capas de visibilidad

| Dónde | Qué muestra | Para qué |
|---|---|---|
| **Bandeja (lista de conversaciones)** | Chip violeta `🕐 1 programado · en 2d` | Glance rápido — ¿este contacto tiene algo pendiente? |
| **Conversación abierta (banner arriba)** | "1 mensaje programado · próximo 18 may · 09:00 · en 1 día" | Contexto al responder — ¿qué le va a llegar? |
| **Banner expandido** | Lista detallada con fecha, contenido, acción cancel | Auditoría + intervención |

### Forma de programar — el script de cómo el cliente lo usa

Cuando demuestres en una llamada, hacé exactamente esto:

1. **Abrí una conversación cualquiera** del cliente
2. **Mostrá el asistente IA en la barra lateral**
3. **Escribí literalmente:** *"Programá un mensaje a este contacto para
   mañana a las 10:30 que diga: Hola, ¿pudiste revisar la propuesta?"*
4. **El asistente responde:** confirmación + fecha + hora exactas
5. **Cerrás la conv y volvés a la bandeja** → el chip violeta `🕐 1`
   aparece al lado del nombre del contacto
6. **Abrís la conv otra vez** → el banner violeta arriba muestra
   "1 mensaje programado · próximo... · en 1 día"

Demo de **2 minutos**. Cierra solo.

---

## Pitch scripts listos para usar

### Apertura del tema en una llamada

> "Mirá [nombre], desde la última vez que hablamos, sacamos 2 capacidades
> nuevas en el CRM que son justamente lo que vos mencionabas el mes
> pasado. ¿Tenés 3 minutos para que te las muestre?"

Si la última conversación fue sobre venta masiva → habrá Campañas.
Si fue sobre olvidos / seguimiento → mencioná Mensajes Programados.

### Para Campañas (apertura de problema)

> "Hoy, cuando vos querés mandarle una promo a tus 80 clientes, ¿qué
> hacés? ¿Lo mandás uno por uno desde el WhatsApp? ¿O usás alguna
> herramienta tipo Bulk Sender?"
>
> **(esperar respuesta)**
>
> Si dice "uno por uno": *"Te imaginás cuánto tiempo se ahorra tu
> equipo si eso se programa una vez y sale solo?"*
>
> Si dice "Bulk Sender" o nombre similar: *"¿Y nunca te bloquearon el
> número? Es una de las quejas más comunes que escuchamos. Lo que sacamos
> nosotros está diseñado específicamente para que NO te pase eso."*

### Para Mensajes Programados (apertura de problema)

> "Cuando vos o tu equipo prometen 'te mando la info el jueves a las 10',
> ¿cómo se aseguran de que efectivamente lleguen? ¿Calendar? ¿Memoria?"
>
> **(esperar respuesta)**
>
> "El problema es que cuando el equipo crece, esos 'compromisos
> implícitos' se pierden. Nosotros sumamos algo que cambia eso: vos le
> decís al asistente IA del CRM 'programá un mensaje a este contacto
> para el jueves a las 10 que diga X' y el sistema se ocupa solo. Y lo
> mejor: todo tu equipo ve qué hay programado para cada contacto
> directamente en la bandeja. Cero contradicciones."

### Cierre estándar

> "Lo que recién te mostré viene como add-on premium del CRM. Lo
> activamos en menos de 1 minuto desde el panel de admin, sin migración
> ni training. ¿Lo activamos hoy mismo así tu equipo arranca a usarlo
> esta semana?"

---

## Objeciones frecuentes y cómo responder

### "¿No es lo mismo que usar Zapier / n8n con WhatsApp?"

> "Zapier o n8n te dan automatización, pero no integran visualmente con
> tu CRM. Tus agentes no ven en la bandeja qué mensajes están programados.
> Acá todo está en el mismo lugar. Y además, las campañas masivas en n8n
> NO tienen anti-detection — si mandás 200 mensajes en 30 minutos, te
> banean igual que un blaster."

### "Yo uso WhatsApp Business API oficial de Meta, ¿para qué quiero esto?"

> "Si ya tenés API oficial andando y funciona bien para tu volumen,
> esto te puede no servir. Pero hay 2 escenarios donde igual conviene:
>
> 1. Si querés mandar mensajes con **texto libre** sin tener que pasar
>    por templates pre-aprobados (a Meta los cambios le toman 1-2 días).
> 2. Si tu volumen no justifica el costo de Meta (que escala rápido con
>    cantidad de mensajes y agentes).
>
> ¿Querés que comparemos los números con tu volumen actual?"

### "Es caro"

> "El precio del add-on es [X]. Comparado con:
> - Una agencia que te mande las campañas por vos: 5-10x más mensual.
> - WhatsApp Business API oficial con tu volumen: 3-4x con setup
>   complicado.
> - El costo de que te baneen el número y perder a tus clientes: imposible
>   de calcular.
>
> Y se paga 1 vez por activación, no por mensaje. Si tu equipo lo usa
> bien, **se paga solo en 2-3 campañas**."

### "¿Y si me ban?"

> "Las protecciones que tenemos están diseñadas para que NO te baneen
> mientras respetes los caps. El cap es 200/24h por número — no podés
> mandar 1000 al día desde 1 solo número. Si necesitás más volumen,
> sumás otro número o esperás al día siguiente. Eso es lo que sostiene
> la garantía: si vos no rompés el cap, el sistema no rompe el cap."

### "¿Funciona con mi WhatsApp actual o necesito uno nuevo?"

> "Funciona con tu número actual de WhatsApp Business, siempre que esté
> conectado al CRM vía Evolution API (que es como lo conectamos
> normalmente). No necesitás un número nuevo."

### "¿Es legal mandar mensajes masivos por WhatsApp?"

> "Mandarle a tus clientes con quienes ya tenés una relación previa
> (te dieron su número, son leads identificados) es totalmente legal y
> dentro de los términos de WhatsApp. **Lo que está prohibido es mandar
> a contactos que no te conocen** (cold outreach masivo). Nuestro sistema
> está pensado para tu base existente: clientes, leads que pidieron
> info, suscriptores."

### "¿Puedo probarlo antes?"

> "Te ofrezco esto: hagamos una demo conjunta esta semana donde armemos
> juntos UNA campaña real con TU base y la mandamos. Si después de eso
> querés activarlo full, lo hacemos. Si no, no hay compromiso."

---

## Comparativa rápida vs alternativas (printeable)

### Para Campañas

| | Blasters externos | Meta API oficial | **Nodo Campañas Evolution** |
|---|:---:|:---:|:---:|
| Riesgo de ban del número | 🔴 Alto | 🟢 Cero | 🟢 Mínimo |
| Texto libre (no templates) | ✅ | ❌ | ✅ |
| Setup tiempo | Inmediato | 2-4 semanas aprobación Meta | Inmediato |
| Pricing | Bajo, riesgoso | Alto, escala con volumen | Add-on único |
| Integrado al CRM | ❌ | ⚠️ Vía integración | ✅ Nativo |
| Personalización por contacto | ⚠️ | ✅ Con limits | ✅ |
| Imagen / archivo | ✅ | ✅ | ✅ |

### Para Mensajes Programados

| | Calendar / Post-its | Email schedulers | n8n / Zapier | **Nodo Programados IA** |
|---|:---:|:---:|:---:|:---:|
| Manda el mensaje solo | ❌ (solo recuerda) | ✅ pero email | ✅ | ✅ |
| Visibilidad para el equipo | ❌ | ⚠️ | ❌ | ✅ |
| WhatsApp soportado | N/A | ❌ | ⚠️ via API | ✅ |
| Cancel inline | N/A | ⚠️ | ❌ | ✅ admin-only |
| Auditoría completa | ❌ | ⚠️ | ⚠️ | ✅ |
| Setup | Inmediato | Inmediato | 2-3 días | Inmediato |

---

## Demo de 5 minutos (cheat sheet)

### Si tenés solo 5 minutos:

**Minuto 1: contexto**
> "Te muestro 2 cosas nuevas. La primera resuelve el envío masivo
> seguro a tus clientes. La segunda los seguimientos automáticos."

**Minuto 2-3: Campaña en vivo**
1. Abrí tab "Campañas → Evolution" → "Crear"
2. Mostrá la quota: *"Te quedan 200 mensajes hoy"*
3. Escribí mensaje con `{{nombre}}`
4. Elegí 1 etiqueta con 3-5 contactos
5. Programá para ahora + 2 minutos
6. **Mostrá el indicador de quota cambiar** en vivo

**Minuto 4-5: Mensaje programado en vivo**
1. Abrí una conversación cualquiera
2. Asistente IA → *"Programá un mensaje para mañana a las 10:30 que
   diga: Te recuerdo nuestra reunión a las 14"*
3. Confirmá → cerrá conv
4. En la bandeja: **mostrá el chip violeta** apareciendo
5. Abrí la conv otra vez: **mostrá el banner**

**Cierre:**
> "Lo activamos hoy, tu equipo lo usa esta semana. ¿Hablamos del paso
> siguiente?"

---

## Métricas clave para social proof

### Campañas
- **200 mensajes / 24h** cap por número (controla volumen)
- **3 a 20 segundos** delay aleatorio (anti-detection)
- **5 variables** de personalización
- **1 minuto** para activar
- **0 templates** requeridos (texto libre)

### Mensajes programados
- **3 capas** de visibilidad (bandeja + banner + sidebar)
- **2 orígenes** diferenciados visualmente (manual 🔔 vs campaña 📢)
- **60 segundos** de polling automático
- **3 reintentos** si falla un envío
- **Auditoría completa** (cancelados no se borran)

### Combo (ambas activadas)
- **Tiempo medio para activar:** menos de 5 minutos
- **Tiempo medio para primer envío real del equipo:** menos de 30 minutos
- **Training requerido:** 0 (interfaz autoexplicativa)

---

## Preguntas que SIEMPRE te van a hacer

**¿Funciona en mi país?**
Sí, funciona en cualquier país donde WhatsApp Business esté disponible
(prácticamente todos excepto China y Cuba). El sistema es agnóstico al
país del receptor.

**¿En qué idiomas está la interfaz?**
Español, inglés, portugués y todos los idiomas estándar de Chatwoot.
Los textos del CRM (incluido el chip violeta y el banner) están
traducidos.

**¿Cuántos números de WhatsApp puedo conectar?**
Tantos como quieras. Cada uno tiene su propio cap de 200/24h, así que
con 3 números podés mandar 600/24h en paralelo (sin riesgo).

**¿Las campañas se pueden duplicar?**
Sí. Desde el listado de campañas podés "duplicar" para reusar título +
contenido + audiencia y cambiar solo el horario.

**¿Puedo agendar mensajes a más de 30 días?**
Sí, hasta 90 días al futuro. Más allá de eso conviene usar
recordatorios externos.

**¿Y si el cliente bloquea / borra mi WhatsApp?**
El sistema detecta los errores de envío y los marca como "fallido" en
el log. No reintenta indefinidamente (3 reintentos máx). El agente lo
ve y puede actuar.

**¿Cancelar una campaña afecta los mensajes ya enviados?**
No. Los mensajes ya enviados llegaron al cliente. Solo los pendientes
(no enviados todavía) se cancelan.

**¿Hay reporte / estadísticas?**
Está en el roadmap próximo. Por ahora podés ver el estado de cada
mensaje individual desde la conversación de cada contacto (cada
mensaje queda como saliente, igual que si lo hubieras escrito vos).

---

## Roadmap visible al cliente (qué viene)

Si te preguntan "¿y qué más viene?", podés mencionar:

- **Dashboard de estadísticas de campañas** (próximo trimestre)
- **Filtros y archivo de campañas viejas** (próximo trimestre)
- **Templates de campañas reutilizables** (próximo trimestre)
- **Edición inline de mensajes programados** (en desarrollo)
- **Variables custom (campos personalizados)** (próximo trimestre)

NO menciones específicamente:
- Plazos exactos de release (puede cambiar)
- Roadmap interno técnico (no es relevante para el cliente)

---

## Material de soporte

- **Documento marketing Campañas:**
  `docs/marketing/01-campanas-whatsapp-evolution.md`
- **Documento marketing Mensajes Programados:**
  `docs/marketing/02-mensajes-programados.md`
- **Documentación técnica interna (NO mostrar al cliente):**
  `README_NODO.md` en el repo

Si necesitás un demo armado pre-configurado para una llamada, hablalo
con el equipo de producto con 24h de anticipación.

---

## Recordatorio final

Estas dos capacidades son **lo más diferenciador del CRM Nodo hoy**. No
hay otro CRM low-cost del mercado que las tenga combinadas. Cuando
abras una nueva oportunidad o renovás un cliente, **siempre menciona al
menos una de las dos** — son los hooks más fuertes que tenemos para
upgrade.

**Cualquier duda, escribime al equipo de producto en Slack.**
