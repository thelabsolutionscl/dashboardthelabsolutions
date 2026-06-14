# Agent_Queue — Cola de Agentes IA

Sistema de captación y procesamiento de leads:

```
Web / Google Ads / LinkedIn
        │  POST (+ clave anti-bot)
        ▼
thelab-leads-worker  (Cloudflare Worker, carpeta lead-worker/)
        ├─→ Airtable: Clientes   (crea el lead)
        └─→ Airtable: Agent_Queue (tarea Pendiente para LEAD_AGENT / LINKEDIN_AGENT)
        ▼
Dashboard (index.html) → tab Agentes → "Cola de Agentes"
        └─ procesa con Claude → guarda Output, Lead Score y actualiza el Cliente
```

## 1. Tablas Airtable

### Agent_Queue  (`tblKGl6zLcQWiaD9x`)
| Campo | Tipo | Notas |
|---|---|---|
| Evento | text | `lead.created`, `google_ads.lead_received`, `linkedin.lead_received` |
| Entidad | text | ej. `Cliente` |
| ID entidad | text | record id del cliente |
| Agente | singleSelect | `LEAD_AGENT`, `LINKEDIN_AGENT`, … |
| Estado | singleSelect | `Pendiente` → `Procesando` → `Completado` / `Error` |
| Prioridad | singleSelect | `Alta` / `Media` / `Baja` |
| Input JSON | longtext | payload normalizado |
| Output | longtext | respuesta del agente |
| Accion sugerida | longtext | próxima acción extraída |
| Lead Score | number | 1–10 |
| Source | text | `web` / `google_ads` / `linkedin` / `whatsapp` |
| Campaign | text | utm_campaign |
| Fecha creación | dateTime | ISO |
| Fecha ejecución | dateTime | ISO |
| Error | longtext | mensaje si falla |

### Clientes — campos IA añadidos
`Lead Score IA` (number), `Servicio interés` (singleSelect), `Próxima acción IA` (longtext),
`Último agente ejecutado` (text), `Resumen IA` (longtext).

> El código es **tolerante**: si algún campo no existe, lo descarta y sigue (no rompe).

## 2. Flujo `lead.created`
1. La web hace `POST /lead` al Worker.
2. El Worker crea el **Cliente** y una tarea en **Agent_Queue** (`Estado=Pendiente`, `Agente=LEAD_AGENT`).
3. En el dashboard → **Agentes → Cola de Agentes**, presiona **Procesar** (o **Procesar pendientes**).
4. El dashboard llama a Claude con el prompt del agente + el `Input JSON`.
5. Guarda `Output`, `Lead Score`, `Estado=Completado`, y actualiza el Cliente (`Lead Score IA`, `Servicio interés`, `Próxima acción IA`, `Resumen IA`).
6. Registra la ejecución en **Agent_Log**.

## 3. Procesar leads
- **Manual (hoy):** dashboard abierto + key de Anthropic cargada → botón Procesar.
- **Automático (opcional):** en el Worker, `AUTO_PROCESS_LEADS=true` + `ANTHROPIC_API_KEY`
  → el lead queda pre-scoreado sin intervención (el dashboard solo lo revisa).

## 4. Probar con el Worker
Ver `lead-worker/README.md`. Resumen:
```bash
cd lead-worker
cp .dev.vars.example .dev.vars   # rellena AIRTABLE_TOKEN, PUBLIC_LEAD_KEY, etc.
npx wrangler dev
curl http://localhost:8787/health
```

## 5. Conectar Google Ads
Lead Form → Webhook a `POST /webhooks/google-ads` con header `X-Google-Ads-Webhook-Key: <GOOGLE_ADS_WEBHOOK_KEY>`.
El Worker normaliza `user_column_data` y crea Cliente + Agent_Queue (`Source=google_ads`, prioridad Alta).

## 6. Conectar LinkedIn (vía Make / Zapier)
LinkedIn Lead Gen Forms no manda webhook nativo simple → usa Make/Zapier:
1. Trigger: nuevo lead en LinkedIn.
2. Acción HTTP `POST /webhooks/linkedin` con header `X-Linkedin-Webhook-Key: <LINKEDIN_WEBHOOK_KEY>` y JSON
   `{ name, company, jobTitle, email, phone, service, message, campaign, linkedinClickId }`.
Crea Cliente + Agent_Queue (`Agente=LINKEDIN_AGENT`, `Source=linkedin`).

## 7. Troubleshooting
- **401**: clave incorrecta o ausente (header).
- **Cliente creado pero sin campos IA**: el campo no existe en Airtable → créalo (sección 1).
- **Tarea en `Error`**: revisa la columna `Error`. Causa típica: agente no encontrado o key de Anthropic inválida.
- **No aparece la cola**: en el dashboard falta el token de Airtable → ingrésalo en el modal.
- **`Agente no encontrado`**: el valor de `Agente` no coincide con `AGENTES_CFG` ni con `LEAD_AGENT`.
