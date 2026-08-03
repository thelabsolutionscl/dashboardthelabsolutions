# thelab-leads-worker

Endpoint público de captación de leads (web, Google Ads, LinkedIn) → Airtable (`Clientes` + `Agent_Queue`).
Worker **dedicado y separado** de `sii-worker`. Ningún secreto vive en el repo.

## Rutas
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | — | Estado |
| POST | `/lead` | `X-Public-Lead-Key` (+ Turnstile/rate-limit opc.) | Formulario web |
| POST | `/webhooks/google-ads` | `X-Google-Ads-Webhook-Key` | Google Lead Form |
| POST | `/webhooks/linkedin` | `X-Linkedin-Webhook-Key` | LinkedIn vía Make/Zapier |
| POST | `/portal/link` | `X-Portal-Admin-Key` | El dashboard pide el link del portal de un cliente |
| GET | `/portal?t=…` | token firmado | Portal del cliente: pedidos y cotizaciones |
| POST | `/portal/cotizacion/decision` | token firmado | El cliente aprueba/rechaza su cotización |

### Portal del cliente
El portal lo sirve **este Worker**, no el dashboard: los datos se leen acá con
`AIRTABLE_TOKEN` y al navegador del cliente solo llega HTML ya renderizado con
sus propios pedidos y cotizaciones.

El link es `…/portal?t=recIdCliente.vencimiento.HMAC`, firmado con `PORTAL_SECRET`
y válido 30 días por defecto (máx. 365). No se puede forjar ni reapuntar a otro
cliente, y las decisiones se cruzan contra el dueño de la cotización antes de
escribir en Airtable. Para emitirlo, el dashboard llama a `/portal/link` con
`PORTAL_ADMIN_KEY` (secreto compartido con GitHub Actions; **nunca**
`PUBLIC_LEAD_KEY`, que viaja en el bundle de la web pública).

## Variables y secretos
No-secretas (`wrangler.toml [vars]`): `AIRTABLE_BASE_ID`, `ALLOWED_ORIGINS`, `AUTO_PROCESS_LEADS`,
`ATTACH_FIELD` (opcional: campo de attachments en Clientes donde se sube la
foto/PDF de referencia del cotizador público; por defecto `Adjuntos`. Créalo como
campo tipo *Attachment* en la tabla Clientes — si no existe, el adjunto se descarta
con un log y el lead sigue igual).

Secretos (`npx wrangler secret put NOMBRE`):
`AIRTABLE_TOKEN`, `PUBLIC_LEAD_KEY`, `GOOGLE_ADS_WEBHOOK_KEY`, `LINKEDIN_WEBHOOK_KEY`,
`TURNSTILE_SECRET` (opc.), `ANTHROPIC_API_KEY` (opc., si `AUTO_PROCESS_LEADS=true`),
`PORTAL_SECRET` y `PORTAL_ADMIN_KEY` (portal del cliente).

## Desarrollo local
```bash
cd lead-worker
npm install
cp .dev.vars.example .dev.vars   # rellenar valores reales (NO se commitea)
npx wrangler dev                 # http://localhost:8787
```

## Desplegar
```bash
cd lead-worker
npx wrangler secret put AIRTABLE_TOKEN
npx wrangler secret put PUBLIC_LEAD_KEY
npx wrangler secret put GOOGLE_ADS_WEBHOOK_KEY
npx wrangler secret put LINKEDIN_WEBHOOK_KEY
npx wrangler secret put PORTAL_SECRET       # firma los links del portal
npx wrangler secret put PORTAL_ADMIN_KEY    # mismo valor que el secret PORTAL_ADMIN_KEY de GitHub
# opcionales: TURNSTILE_SECRET, ANTHROPIC_API_KEY
npx wrangler deploy
```
(Opcional) rate-limit: `npx wrangler kv namespace create LEADS_RL`, pegar el id en `wrangler.toml`
y descomentar el binding `RL`.

## Pruebas (curl)
```bash
# Salud
curl https://thelab-leads-worker.TU-SUB.workers.dev/health

# Lead web
curl -X POST https://thelab-leads-worker.TU-SUB.workers.dev/lead \
  -H "Content-Type: application/json" \
  -H "X-Public-Lead-Key: TU_KEY" \
  -d '{"name":"Juan Pérez","company":"Empresa Demo","email":"juan@empresa.cl","phone":"+56912345678","service":"Cartelería","product":"Caja de luz","quantity":"1","deliveryDate":"2026-06-30","source":"web","utmCampaign":"carteleria-santiago","gclid":"TEST"}'

# LinkedIn
curl -X POST https://thelab-leads-worker.TU-SUB.workers.dev/webhooks/linkedin \
  -H "Content-Type: application/json" \
  -H "X-Linkedin-Webhook-Key: TU_KEY" \
  -d '{"name":"María González","company":"Retail Demo","jobTitle":"Marketing Manager","email":"maria@retail.cl","service":"Merchandising","campaign":"linkedin-merch-b2b","linkedinClickId":"TEST-LI"}'

# Link del portal de un cliente (lo mismo que hace el botón del dashboard)
curl -X POST https://thelab-leads-worker.TU-SUB.workers.dev/portal/link \
  -H "Content-Type: application/json" \
  -H "X-Portal-Admin-Key: TU_PORTAL_ADMIN_KEY" \
  -d '{"clienteId":"recXXXXXXXXXXXXXX","dias":30}'
```
Respuesta OK: `{ "ok": true, "clienteId": "rec…", "queueId": "rec…" }`.
