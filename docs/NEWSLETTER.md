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
     **ver/editar**, **vista previa** (correo renderizado con la marca), **pasar a
     revisión**, **programar** (fecha de envío), **marcar enviada**, **enviar prueba**
     y ver métricas (aperturas, clics, bajas).
  4. **Leads calientes** — destinatarios de `Newsletter_Envios` marcados por Make
     como **lead caliente**; con un clic se crea una tarea de seguimiento
     (`FOLLOWUP_AGENT`) en `Agent_Queue` y se marca **Tarea creada**.
  - Cierra con **Audiencia por rubro** (desglose de la base alcanzable).
- El badge del dock muestra el número de **leads calientes sin tarea**.

Funciones JS clave (en `index.html`): `initNewsletter`, `nlLoad`, `renderNlKpis`,
`renderNlCampaigns`, `renderNlLeads`, `renderNlAudience`, `nlGenerate`,
`nlSaveDraft`, `nlSetEstado`, `nlSchedule`, `nlSendTest`, `nlEditOpen`/`nlEditSave`,
`nlLeadToTask`, `nlPreview`, `_nlMdToHtml`, `_nlEmailHtml`, `_nlAudience`,
`_nlBuildContext`, `_nlParse`. El `Cuerpo HTML` (campo en `Newsletter_Campañas`) se
renderiza con `_nlEmailHtml` al guardar/editar y es lo que envía Make.

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

## 4. Alta de suscriptores desde la web (`lead-worker`) — doble opt-in

Ruta **`POST /newsletter`** en `lead-worker/src/index.js` (misma clave
`X-Public-Lead-Key` + honeypot + Turnstile + rate-limit que `/lead`):

```jsonc
// body
{ "email": "...", "name": "...", "company": "...", "source": "Newsletter web",
  "turnstileToken": "...", "company_website": "" /* honeypot, vacío */ }
```

**Doble opt-in** (activo si hay `RESEND_API_KEY` y `NEWSLETTER_DOUBLE_OPTIN ≠ "false"`):
- Crea el `Cliente` **pendiente** (sin marcar `Suscrito newsletter`) y le envía por
  **Resend** un correo de confirmación con un link firmado (token **HMAC** sin estado).
- **`GET /newsletter/confirm?e=…&t=…`** → valida el token y marca `Suscrito newsletter`=true,
  `Email válido`=true. Devuelve una página HTML de confirmación con la marca.
- **`GET /newsletter/unsubscribe?e=…`** → marca `Baja newsletter`=true,
  `Suscrito newsletter`=false (token opcional: un opt-out nunca se bloquea).

Sin Resend configurado, hace **alta directa** (single opt-in), como antes. El token se
firma con `NEWSLETTER_SECRET` (o `PUBLIC_LEAD_KEY` si falta). Los links se arman con el
propio `origin` del Worker (no hay URLs hardcodeadas).

> El formulario de la web apunta a esta ruta (misma env var de endpoint del Worker que
> el formulario de contacto). Variables nuevas en `wrangler.toml`: `NEWSLETTER_DOUBLE_OPTIN`
> (var) y secretos `RESEND_API_KEY`, `NEWSLETTER_SECRET`.

---

## 5. Automatización con Make (envío + tracking)

El dashboard redacta y aprueba; **Make** envía y escucha.

### 5.0 Escenario ya creado (revisar antes de activar)
Se creó en Make el escenario **`The Lab — Newsletter · Envío (Programada → Resend)`**
(team `259748`, id `5438569`), **inactivo/en pausa** — no envía nada hasta que lo
revises, le pongas tu API key y lo actives. Flujo (clonado del patrón ya usado en
la cuenta, envío por **Resend vía HTTP** como el resto de llamadas a APIs):

1. **Airtable · Search** `Newsletter_Campañas` → `Estado = "Programada"` y
   `Fecha envío ≤ hoy` (máx. 1 por corrida).
2. **Iterator** sobre la campaña.
3. **Airtable · Search** `Clientes` → `Suscrito newsletter = true`, `Baja newsletter = false`,
   `Email` no vacío **y segmentación por rubro**: si la campaña tiene `Segmento objetivo`,
   filtra `Industria / Rubro = <segmento>`; si está vacío, va a toda la audiencia (máx. 200).
4. **Iterator** sobre la audiencia.
5. **Airtable · Create** una fila en `Newsletter_Envios` (link a `Campaña` y `Cliente`,
   `Email`, `Rubro`, `Estado = Enviado`, `Fecha envío`) → traza por persona.
6. **HTTP · POST `https://api.resend.com/emails`** (Resend): envía el **`Cuerpo HTML`** ya
   renderizado por el dashboard (fallback al `Cuerpo (Markdown)` si está vacío), `Asunto`,
   remitente `The Lab Solutions <hola@thelab.solutions>`, y **tags** `campania` y `envio`
   (= id de la fila de `Newsletter_Envios`) para casar el tracking.
7. **Airtable · Update** la campaña → `Estado = "Enviada"` (idempotente).

> **Envío por Resend.** En la cuenta de Make **no hay conexión Resend**, así que el
> módulo HTTP lleva un **placeholder** en el header: `Authorization: Bearer
> re_PEGA_AQUI_TU_API_KEY_DE_RESEND`. Reemplázalo por tu API key real en el editor
> de Make (no por chat). Alternativa: módulo nativo **email/SMTP** (`hola@thelab.solutions`).

**Para encenderlo:**
1. En Resend: **verificar el dominio `thelab.solutions`** (DNS: SPF/DKIM) y crear una **API key**.
2. En Make: abrir el escenario → módulo HTTP → pegar la API key en el header `Authorization`.
3. **Reactivar la organización** (hoy está en pausa).
4. Crear una campaña de prueba (`Programada`, `Fecha envío = hoy`) con tu correo como único
   suscrito y **ejecutar una vez** para validar.
5. **Activar** el escenario.

> El `Cuerpo HTML` ya viene con la **plantilla de marca** (cabecera, cuerpo y pie con baja),
> renderizado del Markdown en el dashboard al guardar/editar. El pie incluye un enlace de baja
> (`mailto:hola@thelab.solutions?subject=BAJA`); para baja en un clic, apúntalo a
> `…/newsletter/unsubscribe?e=<email>`.

### 5.1 Tracking — escenario ya creado (revisar antes de activar)
**`The Lab — Newsletter · Tracking (Resend webhook)`** (id `5439094`, **inactivo/en pausa**),
disparado por webhook. URL del hook (pegar en Resend → Webhooks):

```
https://hook.us2.make.com/yvji9pvbnoozrrn2eejw1eurmjpt7nfg
```

Flujo: el webhook recibe el evento de Resend → busca la fila en `Newsletter_Envios`
(por `Email`) → actualiza `Estado` según el evento (`delivered→Entregado`, `opened→Abierto`,
`clicked→Click`, `bounced→Rebote`, `complained→Spam`) → al **click**, marca
`Lead caliente = true` + `Fecha click`, y **auto-encola `FOLLOWUP_AGENT`** en `Agent_Queue`
(anti-duplicado con `Tarea creada`). El dashboard muestra el lead en "Leads calientes".

> **Para encenderlo:** en Resend → *Webhooks*, crear uno a la URL de arriba con los eventos
> `email.delivered/opened/clicked/bounced/complained`, reactivar la org y **activar** el
> escenario. ⚠️ Revisar el primer evento real: el casado de la fila usa `data.to` (email);
> si se quiere casar por la fila exacta, usar el tag `envio` que ya manda el envío (5.0).

---

## 6. Roadmap

- **Fase 1 — Lista (en este repo):** pestaña Newsletter (KPIs, generador IA,
  campañas, leads calientes, audiencia), `NEWSLETTER_AGENT`, RBAC y ruta
  `/newsletter` del Worker. Envío de **prueba** vía `mail-api.php`.
- **Fase 2 — Make (escenarios creados, inactivos):** envío masivo con segmentación +
  `Newsletter_Envios` (5.0) y tracking por webhook de Resend (5.1). Falta poner la API key
  de Resend, verificar el dominio, configurar el webhook y activar.
- **Fase 3 — Web (lista):** formulario de suscripción en la web pública apuntando a
  `/newsletter`, con **doble opt-in** (confirmación por email).
