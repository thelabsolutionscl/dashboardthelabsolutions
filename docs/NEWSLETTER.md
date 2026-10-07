# Newsletter — Sección, Agente IA y datos

Módulo de newsletter del dashboard: redactar con IA el correo de la empresa,
revisarlo, programarlo y medir aperturas/clics. La **audiencia son los clientes
del CRM** (no hay una lista aparte): cada `Cliente` con email y suscrito recibe
la campaña. El **envío real lo ejecuta exclusivamente el proxy autenticado + Resend**; el dashboard redacta,
aprueba, congela la audiencia y dispara el transporte. Quien hace clic en un CTA comercial se marca como **lead caliente** y se encola al
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

## 5. Transporte y tracking autoritativos

### 5.1 Envío real: proxy seguro + Resend

El dashboard llama `POST /newsletter/send` con el `campaignId`. Esa ruta:

1. exige Cloudflare Access y rol `admin`;
2. toma la audiencia aprobada guardada en la campaña;
3. vuelve a validar opt-in, baja, email válido y supresiones;
4. reserva `Newsletter_Envios` antes de transportar;
5. usa Resend con idempotencia y tags por envío;
6. genera una baja firmada por destinatario y headers estándar;
7. cierra la campaña como `Enviada` o `Pausada` según evidencia real.

El antiguo escenario Make **no debe enviar campañas** después del cutover. Puede conservarse apagado solo como referencia histórica.

### 5.2 Tracking: webhook firmado de Resend

Configurar Resend para enviar `email.delivered`, `email.opened`, `email.clicked`,
`email.bounced`, `email.suppressed` y `email.complained` a:

`POST <lead-worker>/newsletter/resend-webhook`

El Worker verifica `svix-id`, `svix-timestamp` y `svix-signature`, deduplica el evento
y usa el tag `envio_id` para actualizar exactamente una fila `Newsletter_Envios`.
No busca por email.

Los clics de baja, privacidad/preferencias o sin URL comercial verificable **no** marcan
`Lead caliente`.

### 5.3 Configuración productiva pendiente

Secretos del **airtable-proxy**:
- `RESEND_API_KEY`
- `NEWSLETTER_SECRET` — mismo valor que en lead-worker
- `NEWSLETTER_UNSUBSCRIBE_BASE`
- opcional `RESEND_FROM`

Secreto del **lead-worker**:
- `RESEND_WEBHOOK_SECRET`

No pegar estas claves en el navegador, Make ni el repositorio.

## 6. Roadmap

- **Fase 1 — Lista (en este repo):** pestaña Newsletter (KPIs, generador IA,
  campañas, leads calientes, audiencia), `NEWSLETTER_AGENT`, RBAC y ruta
  `/newsletter` del Worker. Envío de **prueba** vía `mail-api.php`.
- **Fase 2 — Reemplazada:** el proxy autenticado es el único transporte de campañas y el lead-worker recibe tracking firmado de Resend. Los escenarios Make de envío/tracking deben permanecer apagados.
- **Fase 3 — Web (lista):** formulario de suscripción en la web pública apuntando a
  `/newsletter`, con **doble opt-in** (confirmación por email).
