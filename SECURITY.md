# Seguridad de tokens — cómo funciona y qué hacer

## El problema que esto resuelve

GitHub Pages sirve HTML estático: cualquier valor que el deploy "hornea" en
`index.html` es visible para quien mire el código fuente de la página. Hasta
ahora eso incluía el token de Airtable y la API key de Anthropic.

## Modo proxy (activo automáticamente)

El workflow `deploy.yml` **exige** `PROXY_URL` + `PROXY_KEY`. Si falta
cualquiera, el deploy se detiene sin publicar una nueva versión. La clave
`AIRTABLE_TOKEN` ya no se pasa al job de GitHub Pages ni se inyecta como
fallback en HTML público. La API key de Anthropic tampoco se inyecta.
Los placeholders `%%…%%` quedan sin reemplazar, el cliente los neutraliza
(nunca viajan como credencial) y todas las llamadas van por el Cloudflare
Worker `airtable-proxy`, que guarda los tokens reales como secretos
server-side:

- Airtable → `<worker>/<BASE_ID>/…` con header `X-App-Key`
- Claude (agentes, KAI con streaming, slicer, resumen diario) → `<worker>/anthropic/v1/messages`
- OpenAI (visión e imágenes) → solo rutas permitidas bajo `<worker>/openai/v1/...`

El Worker exige `X-App-Key` **y** que el `Origin` sea el dashboard
(`ALLOWED_ORIGINS`). Esto limita llamadas desde otros sitios en un navegador,
pero NO autentica a un usuario: un cliente HTTP puede enviar ese Origin.
La APP_KEY publicada en HTML no es un secreto. Hace falta autenticación real
en el servidor para proteger datos por usuario/rol. Como contención inmediata,
Claude y OpenAI tienen allowlists y comparten un hard cap global de IA; esto
limita el impacto económico, pero NO reemplaza la autenticación server-side.

## Qué queda expuesto a propósito

| Valor | Riesgo | Mitigación |
|---|---|---|
| `PROXY_KEY` | Alto si está publicada | Pendiente: autenticación de usuario server-side y cuotas; Origin no basta |
| `BASE_ID` de Airtable | Ninguno sin token | — |
| `OPENAI_TOKEN` | Alto | Vive solo como secret del Worker. El dashboard no acepta ni persiste OpenAI keys; el proxy limita endpoints, modelos, tamaño/calidad y comparte el hard cap diario de IA. |
| `GOOGLE_CLIENT_ID`, URLs e identificadores públicos de SII/Ads | Bajo | No autorizan operaciones por sí mismos |
| `SII_WORKER_KEY`, `PORTAL_ADMIN_KEY`, `PRINTER_TUNNEL_TOKEN` | Crítico | Todavía pueden quedar incrustados en HTML público; deben sustituirse por sesiones y permisos server-side antes de considerarse protegidos |

## Contención adicional de septiembre 2026

El proxy solo permite reenviar datos y metadata de la base TLS
(`app1YtD74AqiPWQhy`). Impide usar el PAT del servidor contra otras bases
incluso si alguien copia `APP_KEY`, pero **no protege los registros de la
propia base TLS**: la clave sigue siendo pública en el cliente y Origin se
puede falsificar fuera de un navegador.

La siguiente migración debe autenticar sesiones firmadas en Cloudflare,
autorizar las operaciones por usuario/rol/tabla/fila en cada endpoint,
intermediar desde backend las acciones de SII, portal y máquinas, y solo
después retirar del deploy las credenciales administrativas y rotarlas.
No borrar hoy las claves del frontend sin una ruta compatible: rompería
facturación, portal o controles de taller.

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
3. **OpenAI**: mantener la key únicamente como `OPENAI_TOKEN` del `airtable-proxy`. El workflow ya no inyecta `secrets.OPENAI` en `index.html`; conviene rotar cualquier key que haya estado publicada antes de este cambio.
4. Relanzar el deploy (pestaña Actions → Deploy Dashboard → Run workflow).

## Cómo verificar

Tras el deploy, en el código fuente de <https://dashboard.thelab.solutions>:

- buscar `pat`, `sk-ant` y `sk-proj`/claves OpenAI → **no deben aparecer**
- `curl https://<worker>/health` → debe informar solo booleanos de configuración, nunca secretos
- desde el dashboard, `GET <worker>/openai/usage` debe responder sin ejecutar un modelo

## Sin proxy

Claude y OpenAI quedan **bloqueados deliberadamente** si el Proxy Worker no está
configurado. No existe modo directo para claves de IA en el navegador.

El deploy de GitHub Pages ya no ofrece fallback directo de Airtable: cuando
falta el proxy falla cerrado y preserva el sitio anteriormente publicado.
La prioridad P0 pendiente es sustituir APP_KEY/Origin por autenticación real de
usuario en servidor y aplicar autorización por tabla, fila y campo.
El token del proxy y las claves administrativas de portal, tributación e impresoras
tampoco deben publicarse en HTML; requieren una migración server-side controlada.
