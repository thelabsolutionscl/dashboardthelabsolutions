# Seguridad de tokens — cómo funciona y qué hacer

## El problema que esto resuelve

GitHub Pages sirve HTML estático: cualquier valor que el deploy "hornea" en
`index.html` es visible para quien mire el código fuente de la página. Hasta
ahora eso incluía el token de Airtable y la API key de Anthropic.

## Modo proxy (activo automáticamente)

El workflow `deploy.yml` detecta los secrets `PROXY_URL` + `PROXY_KEY` y, si
existen, **deja de inyectar** `AIRTABLE_TOKEN` en el HTML.
La API key de Anthropic **nunca se inyecta**, haya proxy o no.
Los placeholders `%%…%%` quedan sin reemplazar, el cliente los neutraliza
(nunca viajan como credencial) y todas las llamadas van por el Cloudflare
Worker `airtable-proxy`, que guarda los tokens reales como secretos
server-side:

- Airtable → `<worker>/<BASE_ID>/…` con header `X-App-Key`
- Claude (agentes, KAI con streaming, slicer, resumen diario) → `<worker>/anthropic/v1/messages`

El Worker exige `X-App-Key` **y** que el `Origin` sea el dashboard
(`ALLOWED_ORIGINS`). Esto limita llamadas desde otros sitios en un navegador,
pero NO autentica a un usuario: un cliente HTTP puede enviar ese Origin.
La APP_KEY publicada en HTML no es un secreto. Hace falta autenticación real
en el servidor y límites de consumo para protegerse de abuso externo.

## Qué queda expuesto a propósito

| Valor | Riesgo | Mitigación |
|---|---|---|
| `PROXY_KEY` | Alto si está publicada | Pendiente: autenticación de usuario server-side y cuotas; Origin no basta |
| `BASE_ID` de Airtable | Ninguno sin token | — |
| `OPENAI_KEY` | Medio | El proxy no cubre OpenAI (lo usa solo la visión GPT-4o de fichas). Recomendado: ponerle límite de gasto bajo en OpenAI, o borrar el secret `OPENAI` y pegar la key a mano en el dashboard (se guarda solo en tu navegador). |
| `GOOGLE_CLIENT_ID`, `SII_*`, `ADS_*` | Bajo | Son identificadores/URLs, no credenciales de datos |

## Pasos pendientes de una sola vez (recomendado)

Los tokens viejos ya estuvieron publicados en el HTML, así que hay que rotarlos:

1. **Airtable**: crear un PAT nuevo en <https://airtable.com/create/tokens>
   (mismo scope), actualizarlo en el Worker
   (`cd airtable-proxy && npx wrangler secret put AIRTABLE_TOKEN`) y recién
   después revocar el antiguo. El secret `AIRTABLE` del repo se sigue usando
   solo para el backup semanal (workflow `weekly.yml`, server-side) — actualízalo también.
2. **Anthropic**: crear una key exclusiva del workspace del dashboard en <https://console.anthropic.com/>,
   guardarla únicamente como `ANTHROPIC_TOKEN` del `airtable-proxy` y revocar cualquier
   key anterior o compartida con Claude Code. El navegador y el `lead-worker` no
   almacenan una API key Anthropic: el lead-worker recibe `AI_PROXY_KEY` desde el
   secret de GitHub `PROXY_KEY` y pasa por el mismo hard cap del proxy.
3. Relanzar el deploy (pestaña Actions → Deploy Dashboard → Run workflow).

## Cómo verificar

Tras el deploy, en el código fuente de <https://dashboard.thelab.solutions>:

- buscar `pat` (token Airtable) y `sk-ant` → **no deben aparecer**
- `curl https://<worker>/health` → `{"ok":true,"anthropic":true,"airtable":true}`

## Sin proxy

Claude queda **bloqueado deliberadamente** si el Proxy Worker no está
configurado. No existe modo directo, fallback local ni formulario para guardar
una API key Anthropic en el navegador, tampoco en localhost.

El fallback directo de Airtable es legado y requiere migración por separado.
