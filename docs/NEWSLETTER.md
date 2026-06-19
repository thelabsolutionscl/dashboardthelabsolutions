# Newsletter — Sección, Agente IA y datos

Módulo de newsletter del dashboard: redactar con IA el correo de la empresa,
revisarlo, programarlo y medir aperturas/clics. La **audiencia son los clientes
del CRM** (no hay una lista aparte): cada `Cliente` con email y suscrito recibe
la campaña. El **envío masivo lo hace Make + Resend**; el dashboard redacta,
aprueba y mide. Quien hace clic se marca como **lead caliente** y se encola al
vendedor — reusando el mismo pipeline de `Agent_Queue` que el resto del sistema.

> Relación con lo existente: misma arquitectura que Redes Sociales (agente Claude
> + Airtable como memoria + Make para enviar y escuchar). El newsletter **no
> reemplaza** el correo 1:1 (sección Correo); es comunicación 1:N recurrente.

---

## 1. Dónde vive en el dashboard

- **Pestaña "Newsletter"** (dock desktop, menú móvil y grid móvil). Visible para
  los roles `admin`, `gerencia`, `comercial`, `marketing` y `demo` (`RBAC.tabs`).
- La sección tiene 4 bloques:
  1. **KPIs** — audiencia (clientes con email), suscritos, borradores, enviadas
     (mes) y leads calientes.
  2. **Redactar newsletter** — corre el `NEWSLETTER_AGENT` con un tema/objetivo y
     un segmento (rubro) opcional, y permite **Guardar borrador** en
     `Newsletter_Campañas`.
  3. **Campañas** — lista/filtra `Newsletter_Campañas` por estado; permite
     **ver/editar**, **pasar a revisión**, **programar** (fecha de envío),
     **marcar enviada**, **enviar prueba** y ver métricas (aperturas, clics, bajas).
  4. **Leads calientes** — destinatarios de `Newsletter_Envios` marcados por Make
     como **lead caliente**; con un clic se crea una tarea de seguimiento
     (`FOLLOWUP_AGENT`) en `Agent_Queue` y se marca **Tarea creada**.
  - Cierra con **Audiencia por rubro** (desglose de la base alcanzable).
- El badge del dock muestra el número de **leads calientes sin tarea**.

Funciones JS clave (en `index.html`): `initNewsletter`, `nlLoad`, `renderNlKpis`,
`renderNlCampaigns`, `renderNlLeads`, `renderNlAudience`, `nlGenerate`,
`nlSaveDraft`, `nlSetEstado`, `nlSchedule`, `nlSendTest`, `nlEditOpen`/`nlEditSave`,
`nlLeadToTask`, `_nlAudience`, `_nlBuildContext`, `_nlParse`.

---

## 2. El agente `NEWSLETTER_AGENT` (`AGENTES_CFG`)

Aparece automáticamente en la pestaña **Agentes IA** (lo renderiza
`renderAgentesGrid`) y se invoca desde la sección Newsletter.

| Agente | Rol |
|---|---|
| **`NEWSLETTER_AGENT`** | Redacta el newsletter de la empresa (mensual o de campaña), personalizado por rubro, con foco en aportar valor y generar oportunidades. |

Devuelve **en formato etiquetado** para poder parsearlo y guardarlo por campos:

```
ASUNTO: <máx 60 caracteres>
PREHEADER: <máx 90 caracteres>
CUERPO:
<cuerpo en Markdown>
```

`_nlParse()` separa esas tres partes; `_nlBuildContext()` le pasa al agente la
audiencia (tamaño + top rubros + segmento) y **trabajos reales recientes**
(pedidos `Despachado`/`Listo para despacho`) como prueba social.

---

## 3. Tablas de Airtable (base `app1YtD74AqiPWQhy`)

El dashboard lee/escribe de forma **tolerante** (si falta un campo, lo descarta y
no rompe). Estas tablas **ya están creadas**.

### `Newsletter_Campañas` — `tblD7vgJQMJbZ6AXZ` (una fila por edición/envío)
| Campo | Tipo | Notas |
|---|---|---|
| Campaña | singleLineText | nombre interno (campo primario, ej. `Newsletter Junio 2026`). |
| Mes | singleLineText | |
| Segmento objetivo | multilineText | rubro o criterio de la edición. |
| Asunto | singleLineText | |
| Preheader | singleLineText | texto preview del inbox. |
| Cuerpo (Markdown) | multilineText | contenido del correo. |
| Estado | singleSelect | **Borrador → En revisión → Programada → Enviada**. |
| Fecha envío | date | la usa Make para enviar cuando corresponde. |
| Generada por NEWSLETTER_AGENT | checkbox | la marca el dashboard al guardar. |
| Enviados · Aperturas · Clicks · Rebotes · Bajas | number | las actualiza Make. |
| Tasa apertura (%) · Tasa click (%) | percent | |
| Notas | multilineText | brief de origen. |
| Newsletter_Envios | link | a los destinatarios. |

### `Newsletter_Envios` — `tblVDe4mgDaFkhGDA` (una fila por destinatario por campaña)
| Campo | Tipo | Notas |
|---|---|---|
| Envío | singleLineText | primario. |
| Campaña | link | a `Newsletter_Campañas`. |
| Cliente | link | a `Clientes`. |
| Email | email | |
| Rubro | singleLineText | |
| Estado | singleSelect | delivered/opened/clicked/bounced/complained (lo pone Make). |
| Fecha envío · Fecha apertura · Fecha click | dateTime | |
| Lead caliente | checkbox | lo marca Make al abrir/click. |
| Tarea creada | checkbox | evita duplicar la alerta al vendedor. |
| Notas | multilineText | |

### Campos de newsletter en `Clientes` (`tblKCNnXwAfDiKbQz`)
`Email` · `Industria / Rubro` (segmentación) · **`Suscrito newsletter`** (opt-in) ·
**`Baja newsletter`** (opt-out) · **`Email válido`** · `Newsletter_Envios` (link).

> **Audiencia** = clientes con `Email` y `Baja newsletter` ≠ true.
> **Suscritos** = además con `Suscrito newsletter` = true.

---

## 4. Alta de suscriptores desde la web (`lead-worker`)

Nueva ruta **`POST /newsletter`** en `lead-worker/src/index.js` (misma clave
`X-Public-Lead-Key` + honeypot + Turnstile + rate-limit que `/lead`):

```jsonc
// body
{ "email": "...", "name": "...", "company": "...", "source": "Newsletter web",
  "turnstileToken": "...", "company_website": "" /* honeypot, vacío */ }
```

- Si el email ya existe en `Clientes` → reactiva (`Suscrito newsletter`=true,
  `Baja newsletter`=false, `Email válido`=true).
- Si no existe → crea el `Cliente` mínimo ya suscrito (`Origen lead`=`Newsletter web`).
- **No** encola agentes ni dispara la auto-respuesta de lead: es solo opt-in.

El formulario de suscripción de la **nueva web** debe apuntar a esta ruta (misma
env var de endpoint del Worker que el formulario de contacto).

---

## 5. Automatización con Make (envío + tracking)

El dashboard redacta y aprueba; **Make** envía y escucha.

### 5.0 Escenario ya creado (revisar antes de activar)
Se creó en Make el escenario **`The Lab — Newsletter · Envío (Programada → email)`**
(team `259748`, id `5438569`), **inactivo/en pausa** — no envía nada hasta que lo
revises y lo actives. Flujo (clonado del patrón ya usado en la cuenta):

1. **Airtable · Search** `Newsletter_Campañas` → `Estado = "Programada"` y
   `Fecha envío ≤ hoy` (máx. 1 por corrida).
2. **Iterator** sobre la campaña.
3. **Airtable · Search** `Clientes` → `Suscrito newsletter = true` y
   `Baja newsletter = false` y `Email` no vacío (audiencia, máx. 200).
4. **Iterator** sobre la audiencia.
5. **Email · Send** (conexión **SMTP `hola@thelab.solutions`**) con el `Asunto`,
   `Preheader` y `Cuerpo (Markdown)` de la campaña.
6. **Airtable · Update** la campaña → `Estado = "Enviada"` (idempotente: evita
   reenvíos en la siguiente corrida).

> **Se usa SMTP, no Resend**, porque en la cuenta de Make **no hay conexión
> Resend** (sí Airtable y SMTP). Para volúmenes altos conviene migrar el módulo
> de envío a **Resend** (módulo HTTP `POST https://api.resend.com/emails` con
> `Authorization: Bearer <RESEND_API_KEY>`, igual que las llamadas a Claude),
> que mejora la entregabilidad y habilita los webhooks de apertura/clic.

**Para encenderlo:** reactivar la organización (hoy está en pausa) → revisar el
escenario → enviar una prueba con una campaña de test → **activar**. El cuerpo va
en Markdown con `white-space:pre-wrap`; si quieres HTML rico (negritas, títulos),
conviene renderizar el Markdown antes (módulo de texto o el paso a Resend).

### 5.1 Envío masivo (alternativa Resend)
- **Trigger:** Airtable *Watch Records* sobre `Newsletter_Campañas`, vista
  `Estado = Programada` **y** `Fecha envío <= hoy`.
- **Audiencia:** *Search Records* en `Clientes` con `Suscrito newsletter = true`
  **y** `Baja newsletter ≠ true` (y filtrando por el `Segmento objetivo` si aplica).
- **Envío:** Resend (API o *Broadcast*) con `Asunto` + `Preheader` + el
  `Cuerpo (Markdown)` renderizado a HTML, con link de **baja** (actualiza
  `Baja newsletter`). Crea una fila por destinatario en `Newsletter_Envios`.
- **Cierre:** *Update Record* → `Estado = Enviada`, `Fecha envío = now`, `Enviados = N`.

### 5.2 Tracking (webhooks de Resend → `Newsletter_Envios`)
- *opened/clicked/bounced/complained* → actualiza la fila (`Estado`, fechas).
- Al **click**, marca `Lead caliente = true`. El dashboard lo muestra en
  "Leads calientes" y permite encolar `FOLLOWUP_AGENT` (o lo hace Make
  automáticamente creando la tarea en `Agent_Queue` y marcando `Tarea creada`).
- Agregados (`Aperturas`, `Clicks`, `Tasa apertura/click`, `Bajas`) se recalculan
  en `Newsletter_Campañas`.

> Requiere conectar Resend en Make y configurar sus webhooks.

---

## 6. Roadmap

- **Fase 1 — Lista (en este repo):** pestaña Newsletter (KPIs, generador IA,
  campañas, leads calientes, audiencia), `NEWSLETTER_AGENT`, RBAC y ruta
  `/newsletter` del Worker. Envío de **prueba** vía `mail-api.php`.
- **Fase 2 — Make:** envío masivo automático (5.1) + tracking de Resend (5.2).
- **Fase 3 — Web:** formulario de suscripción en la web pública apuntando a
  `/newsletter`, con doble opt-in opcional.
