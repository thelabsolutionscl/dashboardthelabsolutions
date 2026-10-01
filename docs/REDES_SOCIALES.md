# Redes Sociales — Sección y Agentes IA

Módulo de redes sociales del dashboard: planificar, generar y programar contenido,
responder comentarios/DMs con IA y convertir interacciones en leads del CRM.
Se apoya en la misma arquitectura que el resto del sistema (agentes Claude +
Airtable como memoria + Make para publicar y escuchar).

> Relación con lo existente: la tabla **`Contenido`** (de `CONTENT_AGENT`) sigue
> siendo el espacio **editorial / de ideas**. La nueva tabla **`Social_Posts`** es
> la **cola de publicación**: una fila = una publicación lista para programar o
> publicar. Una idea de `Contenido` puede aterrizar como uno o varios `Social_Posts`.

---

## 1. Dónde vive en el dashboard

- **Pestaña "Redes"** (dock desktop, menú móvil y grid móvil). Visible para los
  roles `admin`, `gerencia`, `comercial`, `marketing` y `demo` (`RBAC.tabs`).
- La sección tiene 4 bloques:
  1. **KPIs** — publicados (mes), programados, borradores, interacciones
     pendientes y leads desde redes.
  2. **Generador de contenido** — corre un agente (Caption / Estratega /
     Tendencias / Content) y permite **Guardar como borrador** en `Social_Posts`.
  3. **Calendario de contenido** — lista/filtra `Social_Posts` por red y estado;
     permite **Programar** y **Marcar publicado**.
  4. **Bandeja de interacciones** — comentarios/DMs de `Social_Interactions`; el
     `COMMUNITY_AGENT` **sugiere respuesta**, marca si es **lead** y permite
     **crear el lead** en `Clientes` con un clic.
- El badge del dock muestra el número de interacciones **pendientes**.

Funciones JS clave (en `index.html`): `initRedes`, `redesLoad`, `renderRedesKpis`,
`renderRedesPosts`, `renderRedesInbox`, `redesGenerate`, `redesSaveDraft`,
`redesSetEstado`, `redesReply`, `redesMarkInteraction`, `redesInteractionToLead`.

---

## 2. Los 6 agentes nuevos (`AGENTES_CFG`)

Aparecen automáticamente en la pestaña **Agentes IA** (los renderiza
`renderAgentesGrid`) y también se invocan desde la sección Redes.

| Agente | Rol |
|---|---|
| **`SOCIAL_STRATEGIST`** | Calendario de contenido mensual conectado a lo que pasa en el negocio. |
| **`CAPTION_AGENT`** | Copy listo por red (IG/LinkedIn/TikTok/Facebook) + hashtags + A/B del gancho. |
| **`COMMUNITY_AGENT`** | Responde comentarios/DMs, detecta intención y si es lead (salida etiquetada). |
| **`SOCIAL_ADS_AGENT`** | Optimiza Meta Ads / LinkedIn Ads por **ROAS real del CRM**, no el de la plataforma. |
| **`TREND_AGENT`** | Ganchos y formatos de tendencia (Reels/TikTok) aplicados a los productos. |
| **`REPORT_SOCIAL_AGENT`** | Reporte semanal de redes con foco en leads y ventas atribuidas. |

`COMMUNITY_AGENT` responde en formato etiquetado para poder parsearlo:
`RESPUESTA_PUBLICA:`, `ES_LEAD:`, `INTENCION:`, `SIGUIENTE_PASO:`.
`CAPTION_AGENT` marca los hashtags con una línea `HASHTAGS:` (la usa
`redesSaveDraft` para separarlos del copy al guardar el borrador).

---

## 3. Tablas de Airtable (base `app1YtD74AqiPWQhy`)

El dashboard lee/escribe estas tablas de forma **tolerante**: si una no existe o
falta un campo, no rompe — muestra el estado guía. Ya están creadas.

### `Social_Posts` — `tblcuw5aNNCnovUfB` (cola de publicación)
| Campo | Tipo | Notas |
|---|---|---|
| Copy | multilineText | Texto a publicar (campo primario). |
| Red | singleSelect | Instagram · LinkedIn · TikTok · Facebook |
| Estado | singleSelect | Borrador · Programado · Publicado · Archivado |
| Fecha programada | dateTime | Make publica cuando llega esta fecha (zona `America/Santiago`). |
| Fecha publicación | dateTime | Cuándo se publicó. |
| Hashtags | singleLineText | |
| Objetivo | singleLineText | alcance / leads / marca |
| Media URL | url | imagen/video a publicar |
| Agente | singleLineText | agente que lo generó |
| Pedido | singleLineText | proyecto de origen (referencia) |
| Engagement | number | interacciones tras publicar (Make) — alimenta el reciclaje de contenido |
| Link | url | enlace destino con UTMs (atribución de clics → leads) |

### `Social_Interactions` — `tblIp8LFCWG3JJ5l8` (bandeja)
| Campo | Tipo | Notas |
|---|---|---|
| Mensaje | multilineText | Comentario o DM (campo primario). |
| Red | singleSelect | Instagram · LinkedIn · TikTok · Facebook |
| Tipo | singleSelect | Comentario · DM · Mención |
| Usuario | singleLineText | cuenta que escribió |
| Respuesta sugerida | multilineText | la rellena `COMMUNITY_AGENT` |
| Estado | singleSelect | Pendiente · Respondido · Ignorado |
| Es lead | checkbox | lo marca el agente |
| Lead creado | checkbox | el dashboard lo marca al crear el Cliente — **anti-duplicado durable** |
| Queja | checkbox | el Worker la marca al detectar sentimiento negativo → dispara aviso WhatsApp |
| WA: aviso enviado | checkbox | dedup del aviso WhatsApp (lo marca Make tras enviar) |
| Intención | singleLineText | consulta_precio / interes_producto / soporte / elogio / spam / otro |
| Fecha | dateTime | |

### `Social_Metrics` — `tblLcAupYzfEkyEbU` (métricas)
| Campo | Tipo |
|---|---|
| Período | singleLineText (primario, ej: `2026-06-19 · Instagram`) |
| Red | singleSelect |
| Fecha | date |
| Alcance · Impresiones · Engagement · Clics · Seguidores nuevos · Leads | number |

---

## 4. Automatizaciones con Make (Fases 2 y 3)

Las tablas están diseñadas para que Make sea quien **publica** y **escucha**. El
dashboard solo aprueba/edita. Blueprints sugeridos:

### 4.1 Publicación automática (`Social_Posts` → redes)
- **Trigger:** Airtable — *Watch Records* sobre `Social_Posts`, vista filtrada
  `Estado = Programado` **y** `Fecha programada <= ahora`.
- **Router por `Red`:**
  - Instagram/Facebook → módulo *Facebook Pages / Instagram for Business* → *Create a Post / Publish Photo* (usa `Copy` + `Media URL` + `Hashtags`).
  - LinkedIn → módulo *LinkedIn* → *Create a Post*.
  - TikTok → módulo *TikTok* (o Buffer/Metricool como puente si hace falta).
- **Cierre:** Airtable *Update Record* → `Estado = Publicado`, `Fecha publicación = now`.

> Requiere conectar en Make las cuentas de Meta Business, LinkedIn y TikTok.

### 4.2 Comentario / DM → bandeja (y → lead)
- **Trigger:** Make — *Watch Comments / Watch Messages* de Instagram/Facebook
  (y LinkedIn vía su módulo o un puente).
- **Acción:** Airtable *Create Record* en `Social_Interactions`
  (`Red`, `Tipo`, `Usuario`, `Mensaje`, `Estado = Pendiente`, `Fecha`).
- **Opcional (auto-IA):** llamar al proxy de Claude
  (`<worker>/anthropic/v1/messages`) con el system prompt de `COMMUNITY_AGENT`,
  guardar `Respuesta sugerida` + `Es lead` + `Intención`. Si `Es lead = true`,
  crear `Cliente` (`Etapa venta = Lead nuevo`, `Origen lead = Redes sociales`) y
  una tarea en **`Agent_Queue`** (`Agente = LEAD_AGENT`, `Source = instagram`),
  reutilizando el pipeline existente.

### 4.3 Pedido entregado → borrador de post
- **Trigger:** Airtable *Watch Records* en `Pedidos`, `Estado pedido = Listo para
  despacho`/`Despachado` con `Foto QA URL` presente.
- **Acción:** llamar a `CAPTION_AGENT` (proxy Claude) con el detalle del pedido y
  crear un `Social_Posts` (`Estado = Borrador`, `Media URL = Foto QA URL`). Tu
  mejor contenido es tu propia producción.

### 4.4 Métricas diarias → `Social_Metrics`
- **Trigger:** Make *Schedule* diario.
- **Acción:** *Get Insights* de cada red → Airtable *Create Record* en
  `Social_Metrics` (un registro por red por día).

### 4.5 Reporte semanal automático
- **Trigger:** *Schedule* lunes AM.
- **Acción:** leer `Social_Metrics` de la semana → `REPORT_SOCIAL_AGENT` (proxy
  Claude) → enviar por email (ya existe `mail-api.php` / Resend en el stack).

---

## 5. Roadmap

- **Fase 1 — Lista (en este repo):** 6 agentes + pestaña Redes con KPIs,
  generador, calendario y bandeja, leyendo/escribiendo Airtable. Publicación y
  respuesta manual (aprobar/editar/copiar).
- **Fase 2 — Make:** publicación automática (4.1) y captura de comentarios/DMs →
  leads (4.2). Requiere conectar Meta/LinkedIn/TikTok en Make.
- **Fase 3 — Métricas y reporte:** ingesta de `Social_Metrics` (4.4), atribución
  de leads por red y reporte semanal automático (4.5).

---

## 6. Mejoras implementadas (auditoría + upgrades)

Sobre la base anterior se ejecutó una auditoría y se añadió:

- **Programar con fecha real** (modal date-picker `datetime-local`) — sin fecha, la
  automatización de Make no sabría cuándo publicar. Incluye *Reagendar*.
- **Vista Calendario mensual** con **drag & drop**: arrastra una publicación a otro
  día para reprogramarla (junto a la vista Lista).
- **Generar desde pedido entregado**: selector de pedidos `Despachado`/`Listo para
  despacho`; usa su `Foto QA URL` como media y referencia el N° de pedido.
- **Guardar 1 post por red**: parsea la salida multi-red de CAPTION/CONTENT y crea
  un `Social_Posts` por plataforma (además del guardado único).
- **Media URL + preview**: miniatura de imagen/video en lista y calendario.
- **Bandeja**: *Sugerir pendientes* (procesa todas las interacciones pendientes) y
  **anti-duplicado** al crear leads.
- **Lead → `Agent_Queue`**: al convertir una interacción en lead se encola un
  `LEAD_AGENT` (Source = red), igual que el pipeline web/LinkedIn/Google Ads.
- **Métricas + reporte semanal IA**: barras por red desde `Social_Metrics` y el
  `REPORT_SOCIAL_AGENT` con botón *Enviar por email* (vía `MAIL.post`).
- **Agentes sociales delegables desde KAI** (el asistente IA).
- **RBAC acotado**: el rol `marketing` (sin escritura global) puede escribir solo en
  `Social_Posts`, `Social_Interactions`, `Social_Metrics`, `Clientes` y `Agent_Queue`
  (`RBAC.canWriteTable` + `RBAC.socialWriteTables`). Así, al convertir una interacción
  en lead, `marketing` también lo encola para scoring igual que el resto de roles.

### Auditoría 3 — features avanzadas

- **Edición inline** de cada publicación (modal): red, estado, fecha, copy, hashtags,
  media, objetivo y link; con **eliminar**. Se abre desde la lista (✏ Editar) o clic
  en un chip del calendario.
- **Flujo de aprobación**: estado `En revisión` entre Borrador y Programado
  (Borrador → 👀 A revisión → ✓ Aprobar y programar).
- **Programación masiva** (`⚙ Auto-programar`): reparte los borradores 1 por día desde
  mañana a la mejor hora por red.
- **Mejor momento para publicar**: mejor día por red desde `Social_Metrics`
  (engagement) + hora sugerida; botón ✨ en el modal de fecha.
- **Constructor de UTM** en el editor → campo `Link` (`utm_source=red&utm_medium=social&utm_campaign=…`).
- **Reciclar contenido**: top performers (`Social_Posts` Publicados por `Engagement`)
  con re-publicación en un clic (clona como Borrador).
- **Biblioteca de hashtags** por red (localStorage): guardar/insertar sets desde el editor.
- **Sentimiento en la bandeja**: detecta quejas (heurístico + `Intención`), las prioriza
  arriba y las marca (⚠ queja); contador de quejas en la cabecera.
- **Anti-duplicado de leads durable** (campo `Social_Interactions."Lead creado"`) y
  guards de concurrencia (`_redesLoadBusy`, `_redesReplyBusy`).

---

## 7. Captura server-side + notificaciones (auditoría 4)

### 7.1 Worker — `POST /webhooks/social`
`lead-worker/src/index.js` ahora expone `/webhooks/social` (clave
`SOCIAL_WEBHOOK_KEY`, con fallback a `PUBLIC_LEAD_KEY`). Recibe comentarios y DMs
desde Make y:
1. Siempre crea la fila en **`Social_Interactions`** (tolerante a campos faltantes).
2. Detecta **queja** (sentimiento negativo, `socialIsComplaint`) y marca `Queja`.
3. Si el payload trae `esLead:true`, crea **Cliente + `Agent_Queue`** (LEAD_AGENT,
   `Source` = red) reutilizando el núcleo `createLeadAndQueue` — y lo pre-scorea si
   `AUTO_PROCESS_LEADS=true`.

Funciona aunque el dashboard esté cerrado. Payload esperado (campos flexibles):
```json
{ "red":"instagram", "tipo":"DM", "usuario":"cafe.lamorena",
  "mensaje":"cuánto sale un neón con mi logo?", "esLead":true, "intencion":"consulta_precio" }
```
> **Recomendado:** que el escenario de captura de Make haga `POST` a este endpoint
> (en vez de escribir Airtable directo), así la marca `Queja` y el encolado de leads
> quedan centralizados en el Worker.

### 7.2 Estado real de Make (team `259748`)
Conexiones disponibles hoy: **Airtable, Gmail, SMTP**. **No hay ninguna conexión
social** (Instagram/Facebook/LinkedIn/TikTok). WhatsApp va por **HTTP → WATI** (sin
conexión dedicada). Por lo tanto:
- ✅ **Listo para construir** (solo Airtable/HTTP): avisos WhatsApp (7.3), reporte
  semanal por email, ingesta de métricas si la trae un endpoint propio.
- ⛔ **Bloqueado hasta conectar OAuth tú**: publicación automática y captura nativa
  de comentarios/DMs en Meta/LinkedIn/TikTok. Conecta esas cuentas en Make → Mis
  conexiones, y luego se arman los escenarios 4.1 y 4.2.

### 7.3 Avisos por WhatsApp (clonar un escenario WATI existente)
Mismo patrón que `The Lab — WhatsApp · Leads asignados → Nicanor`
(Airtable *Search* → *Feeder* → *Search* → HTTP *WATI* → *Update* dedup). Crear dos:
1. **Queja entrante** — filtro `AND({Queja}, NOT({WA: aviso enviado}))` sobre
   `Social_Interactions` → WhatsApp al encargado → marca `WA: aviso enviado`.
2. **Lead caliente de redes** — filtro `AND({Es lead}, NOT({WA: aviso enviado}))` →
   WhatsApp a Nicanor → marca `WA: aviso enviado`.

Los campos `Queja` y `WA: aviso enviado` ya existen en `Social_Interactions`.

### 7.4 Tests
`tests/redes.test.js` (correr con `node tests/redes.test.js`) extrae las funciones
reales de `index.html` y prueba el parser por red (`_redesSplitByNetwork`), el
sentimiento (`_redesSentiment`) y el mejor día (`_redesBestByWeekday`). 12 aserciones.
