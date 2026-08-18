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
| POST | `/portal/revocar` | `X-Portal-Admin-Key` | Invalida los links ya enviados a un cliente |
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

**Revocar** (botón *Revocar links del portal* en la ficha del cliente) sube un
contador por cliente en el KV que entra en la firma: sus enlaces dejan de abrir
al instante y los de los demás siguen igual. Requiere el binding `RL`; sin KV la
ruta responde 501 en vez de fingir que revocó. La propagación del KV entre
regiones puede tardar hasta ~1 minuto.

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

## Canario del formulario web (diario, 07:17 UTC)

Una vez al día el Worker consulta `https://thelab.solutions/api/lead/health` —el
chequeo que resuelve el endpoint igual que las server actions de la web— y
**avisa por correo solo si los formularios dejaron de entregar al CRM**. Si todo
está bien no manda nada.

Nace del incidente del 2026-08-18: las fichas de la web entraron por email y no
al CRM durante casi un mes, sin que nada fallara a la vista. El deploy de la web
ya lo verifica al publicar; este canario cubre lo otro, que alguien borre una
variable después y nadie se entere.

| Variable | Default | Para qué |
|---|---|---|
| `LEAD_FORM_HEALTH_URL` | `https://thelab.solutions/api/lead/health` | Sobrescribe la URL del chequeo (staging, dominio nuevo) |
| `LEADS_NOTIFY_TO` | `thelabsolutionscl@gmail.com` | Destino del aviso |

Comprobarlo a mano en cualquier momento:

```bash
curl -s https://thelab.solutions/api/lead/health
# {"ok":true,...} = los formularios entregan al pipeline
```

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
