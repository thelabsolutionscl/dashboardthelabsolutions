# Pipeline de Ventas con Agentes IA — The Lab Solutions

Documento explicativo de cómo funciona el sistema de captación y procesamiento de
leads de punta a punta: desde que un lead llega por LinkedIn / Google Ads / web,
hasta que un agente Claude lo califica y deja la próxima acción en el CRM.

> Diagrama visual: [`pipeline-diagram.svg`](./pipeline-diagram.svg)
> Tablas y campos de Airtable: [`AGENTS_QUEUE.md`](./AGENTS_QUEUE.md)
> Prueba end-to-end: [`../scripts/test-pipeline.sh`](../scripts/test-pipeline.sh)

---

## 1. Arquitectura en una imagen

```
Web / Google Ads / LinkedIn
        │  POST  (+ llave anti-bot en header)
        ▼
thelab-leads-worker  (Cloudflare Worker — lead-worker/src/index.js)
        ├─→ Airtable: Clientes      (crea / deduplica el lead)
        ├─→ Airtable: Agent_Queue   (tarea "Pendiente" para LEAD_AGENT / LINKEDIN_AGENT)
        ├─→ Email speed-to-lead      (Resend, best-effort, no bloquea)
        └─→ (opcional) procesa con Claude server-side y pre-scorea el lead
        ▼
Dashboard (index.html) → tab Agentes → "Cola de Agentes"
        └─ processAgentQueueItem() → callClaude() →
           guarda Output + Lead Score + actualiza el Cliente + Agent_Log
```

**Idea central:** el Worker captura y normaliza, los agentes (Claude) razonan, y
Airtable es la memoria compartida. Nada se procesa "en vivo" en la web — todo
pasa por una cola desacoplada (`Agent_Queue`).

Dos repos trabajan juntos:

| Repo | Rol | Pieza clave |
|---|---|---|
| `web-thelab-solutions` | Web pública (Next.js). Convierte una visita en un lead. | `src/.../Contact.tsx` |
| `dashboardthelabsolutions` | Worker de captación + dashboard donde corren los agentes. | `lead-worker/src/index.js`, `index.html` |

---

## 2. El equipo de agentes

No es un agente, son **14 agentes especializados**, cada uno con su propio system
prompt en `index.html` (`AGENTES_CFG`, ~línea 5211). Cada agente es un rol de la
empresa convertido en prompt.

| Categoría | Agentes |
|---|---|
| **Ventas / Leads** | `LEAD_AGENT`, `LINKEDIN_AGENT`, `SALES_AGENT`, `LEAD_GEN_AGENT`, `FOLLOWUP_AGENT` |
| **Operación** | `QUOTE_AGENT`, `PRODUCTION_AGENT`, `QA_AGENT`, `ONBOARDING_AGENT`, `REPORTE_CLIENTE` |
| **Negocio / Marketing** | `CEO_AGENT`, `FINANCE_AGENT`, `ADS_AGENT`, `CONTENT_AGENT` |

De estos 14, **solo `LEAD_AGENT` y `LINKEDIN_AGENT` corren automáticamente** sobre
la cola de leads. El resto se disparan manualmente desde el dashboard cuando se
necesitan (cotizar, producir, hacer QA, seguir, etc.).

> Nota: el system prompt de `LEAD_AGENT`/`LINKEDIN_AGENT` que corre **en el Worker**
> (`SYS_LEAD` / `SYS_LINKEDIN`) pide salida en **JSON estricto**. El equivalente que
> corre **en el dashboard** pide salida en formato texto con etiquetas. Ambos
> existen porque el mismo lead puede procesarse server-side (automático) o en el
> panel (manual).

---

## 3. El pipeline paso a paso

### Paso 1 — Captura (3 puertas de entrada)

| Ruta | Canal | Auth |
|---|---|---|
| `POST /lead` | Formulario web | `X-Public-Lead-Key` (+ honeypot, Turnstile, rate-limit) |
| `POST /webhooks/google-ads` | Google Lead Form | `X-Google-Ads-Webhook-Key` |
| `POST /webhooks/linkedin` | LinkedIn (vía Make/Zapier) | `X-Linkedin-Webhook-Key` |

### Paso 2 — Normalización
Venga de donde venga, el lead se aplana a una **forma interna única**
(`normalizeWeb` / `normalizeGoogleAds` / `normalizeLinkedin`). El `source` se
infiere: `gclid` → `google_ads`, `li_fat_id` → `linkedin`, si no → `web`.

### Paso 3 — Persistencia (`createLeadAndQueue`)
1. **Dedupe**: busca un Cliente existente por email/teléfono. Si existe, lo
   reutiliza y refresca interés/cargo sin pisar notas ni fecha de primer contacto.
2. Crea la tarea en **Agent_Queue** (`Estado=Pendiente`, agente según canal,
   `Prioridad=Alta` para google_ads y `Media` para el resto).
3. **Speed-to-lead**: email automático de "recibimos tu solicitud" vía Resend.

### Paso 4 — Robustez
- **Tolerancia a campos**: si Airtable rechaza un campo inexistente, lo descarta y
  reintenta (`airtableCreateTolerant`). El lead nunca se pierde por un nombre mal puesto.
- **Dead-letter queue**: si Airtable falla del todo, el lead va a un buffer en KV y
  un **cron** lo reintenta hasta 7 días (`retryDeadLetters`).
- **Anti-bot**: honeypot (responde 200 al bot), Turnstile y rate-limit por IP.

### Paso 5 — Procesamiento por el agente
- **Manual (por defecto)**: dashboard → Agentes → Cola de Agentes → **Procesar**.
  `processAgentQueueItem()` marca `Procesando` → llama a Claude → guarda `Output`,
  `Lead Score`, `Estado=Completado`, `Acción sugerida` → actualiza el Cliente
  (`Lead Score IA`, `Servicio interés`, `Próxima acción IA`, `Resumen IA`) → loguea
  en `Agent_Log`.
- **Automático (opcional)**: con `AUTO_PROCESS_LEADS=true` + `ANTHROPIC_API_KEY` en
  el Worker, el lead se pre-scorea server-side al instante (`processLeadAgent`), con
  tope diario de costo (`AUTO_PROCESS_DAILY_CAP`, default 200/día).

### Paso 6 — De lead a venta
Lead scoreado → `QUOTE_AGENT` cotiza → `ONBOARDING_AGENT` da la bienvenida si
aprueba → `PRODUCTION_AGENT` + `QA_AGENT` en fábrica → `REPORTE_CLIENTE` informa al
cliente → `FOLLOWUP_AGENT` rescata cotizaciones frías. `CEO_AGENT` y `FINANCE_AGENT`
leen todo eso para dar la foto del negocio.

---

## 4. Simulación: lead de LinkedIn de principio a fin

**María González, Marketing Manager de "Retail Demo"**, llena tu LinkedIn Lead Gen Form.

**① LinkedIn → Make/Zapier → Worker**
```http
POST /webhooks/linkedin
X-Linkedin-Webhook-Key: ••••••
Content-Type: application/json

{
  "name": "María González",
  "company": "Retail Demo",
  "jobTitle": "Marketing Manager",
  "email": "maria@retail.cl",
  "service": "Merchandising",
  "message": "Necesitamos kit de bienvenida para 200 colaboradores nuevos",
  "campaign": "linkedin-merch-b2b",
  "linkedinClickId": "li-abc123"
}
```

**② El Worker valida y normaliza** — verifica la llave (401 si falla),
`normalizeLinkedin` aplana el payload y marca `source: "linkedin"`.

**③ Crea Cliente + tarea**
- Busca duplicados por `maria@retail.cl` → no existe → crea **Cliente** (Empresa,
  Contacto, Cargo, Origen `linkedin`, Servicio interés `Merchandising`, tracking).
- Crea tarea en **Agent_Queue**: `Evento=linkedin.lead_received`,
  `Agente=LINKEDIN_AGENT`, `Estado=Pendiente`, `Prioridad=Media`, `Source=linkedin`.
- Email automático a María: *"¡Recibimos tu solicitud! Te contactamos en <24h hábiles"*.
- Responde `{ ok: true, clienteId: "rec…", queueId: "rec…" }`.

**④ El LINKEDIN_AGENT procesa** (al presionar Procesar, o automáticamente). Claude
recibe `SYS_LINKEDIN` + los datos y devuelve:
```json
{
  "score_b2b": 8,
  "servicio_recomendado": "Merchandising",
  "decisor": "Alto",
  "mensaje_linkedin": "Hola María, vimos que buscan kit de bienvenida para 200 colaboradores. En The Lab producimos packs corporativos personalizados end-to-end. ¿Te sirve que te mande referencias y rangos de precio?",
  "email": { "asunto": "Kit de bienvenida x200 — propuesta The Lab", "cuerpo": "María, gracias por tu interés..." },
  "objeciones_probables": ["plazo de entrega para 200 unidades", "presupuesto por unidad"],
  "proxima_accion": "Enviar referencias de kits + pedir fecha límite y presupuesto/unidad",
  "resumen": "Marketing Manager retail, 200 kits onboarding, alta intención, decisor alto."
}
```

**⑤ Se escribe de vuelta**
- **Agent_Queue**: `Estado=Completado`, `Output`, `Lead Score=8`, `Acción sugerida`, `Fecha ejecución`.
- **Cliente María**: `Lead Score IA=8`, `Servicio interés=Merchandising`,
  `Próxima acción IA`, `Último agente ejecutado=LINKEDIN_AGENT`, `Resumen IA`.
- **Agent_Log**: registro de la ejecución.

**⑥ Continúa la venta** — copias el `mensaje_linkedin` para abrir conversación,
pasas el caso al `QUOTE_AGENT` para los 200 kits, y si no responde, el
`FOLLOWUP_AGENT` arma el recordatorio. Todo trazado contra el mismo Cliente.

---

## 5. Fortalezas y límites

**Fortalezas**
- Un solo embudo para 3 canales → datos consistentes.
- Nunca pierde un lead: dedupe + tolerancia a campos + dead-letter con reintento.
- Speed-to-lead automático por email.
- Roles claros: cada agente sabe una cosa y la hace bien.
- Sin secretos en el repo (todo por `wrangler secret`).

**Límites**
- Procesamiento **manual por defecto** — los leads esperan en la cola hasta que
  alguien presione Procesar (salvo que actives `AUTO_PROCESS_LEADS`).
- La `X-Public-Lead-Key` de la web **no es secreto fuerte** (viaja en el bundle);
  es solo fricción anti-bot.
- LinkedIn **depende de Make/Zapier** como puente.
- Los agentes **sugieren, no ejecutan** la venta: el cierre sigue siendo humano.

---

## 6. Probar el pipeline

Ver [`../scripts/test-pipeline.sh`](../scripts/test-pipeline.sh). Resumen:
```bash
cd lead-worker && npx wrangler dev          # levanta el Worker en :8787
# en otra terminal, desde la raíz del repo:
BASE_URL=http://localhost:8787 LEAD_KEY=tu_key ./scripts/test-pipeline.sh
```
El script ejercita `/health`, `/lead`, `/webhooks/google-ads` y `/webhooks/linkedin`
(incluye el caso de María) y verifica que cada respuesta traiga `clienteId` y `queueId`.
