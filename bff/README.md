# thelab-bff — Backend-for-Frontend

Cloudflare Worker que actúa como **única puerta** entre el dashboard estático
(`index.html`) y los proveedores externos (Airtable, Anthropic, OpenAI).

## ¿Qué problema resuelve?

Hoy el dashboard llama **directo desde el navegador** a Airtable, Anthropic y
OpenAI con los secretos inyectados en el cliente. Cualquiera que abra las
DevTools puede leer esos tokens. Esto es inseguro.

El BFF mueve **todos los secretos al servidor** (Cloudflare Secrets). El
navegador ya no conoce ninguna API key: solo presenta un **JWT de sesión** que
el Worker emite tras el login.

## Arquitectura

```
  Navegador                BFF (Worker)                 Proveedores
  ─────────                ────────────                 ───────────
  login ───────────────►  /auth/login  ──valida──►  (usuarios + sha256)
            ◄──── JWT ────
  fetch + JWT ─────────►  /airtable/*  ──Bearer──►  api.airtable.com
  fetch + JWT ─────────►  /ai/anthropic/* ─x-api-key─► api.anthropic.com
  fetch + JWT ─────────►  /ai/openai/*  ──Bearer──►  api.openai.com
```

El navegador **nunca** ve `AIRTABLE_TOKEN`, `ANTHROPIC_KEY` ni `OPENAI_KEY`.
Solo maneja el JWT. El RBAC (quién puede escribir/borrar/configurar) se aplica
**en el servidor**, no se confía en el cliente.

## Cómo lo activa el dashboard

El dashboard define una variable `BFF_URL` (la URL pública del Worker) y un
**interceptor de `fetch`** que reescribe las llamadas salientes:

| Llamada original                          | Se reescribe a                  |
| ----------------------------------------- | ------------------------------- |
| `https://api.airtable.com/v0/<resto>`     | `BFF_URL/airtable/<resto>`      |
| `https://api.anthropic.com/<resto>`       | `BFF_URL/ai/anthropic/<resto>`  |
| `https://api.openai.com/<resto>`          | `BFF_URL/ai/openai/<resto>`     |

Además el interceptor **elimina** cualquier header de credencial
(`Authorization: Bearer key...`, `x-api-key`, etc.) y lo reemplaza por
`Authorization: Bearer <JWT_de_sesión>`.

Si `BFF_URL` está vacío, el dashboard sigue funcionando como antes (modo
legacy directo). Activar el BFF es simplemente setear `BFF_URL`.

## Endpoints

| Método | Ruta                  | Auth | Descripción                                              |
| ------ | --------------------- | ---- | -------------------------------------------------------- |
| GET    | `/health`             | No   | `{ok:true}`                                              |
| POST   | `/auth/login`         | No   | `{username,password,remember}` → `{token, user}`         |
| GET    | `/auth/me`            | JWT  | `{user}` a partir del token                              |
| *      | `/airtable/<resto>`   | JWT  | Proxy a `api.airtable.com/v0/<resto>` (RBAC server-side) |
| POST   | `/ai/anthropic/<resto>` | JWT | Proxy a `api.anthropic.com/<resto>` (streaming)         |
| POST   | `/ai/openai/<resto>`  | JWT  | Proxy a `api.openai.com/<resto>` (streaming + multipart) |
| POST   | `/queue/process`      | JWT  | Procesa `Agent_Queue` (rol admin/gerencia/marketing)     |

Además, un **cron** (`*/5 * * * *`) ejecuta `processQueue` automáticamente.

### RBAC (aplicado en `/airtable/*`)

| Rol        | Escribir | Borrar | Config (meta/) |
| ---------- | -------- | ------ | -------------- |
| admin      | sí       | sí     | sí             |
| gerencia   | sí       | sí     | no             |
| comercial  | sí       | no     | no             |
| produccion | sí       | no     | no             |
| finanzas   | sí       | no     | no             |
| marketing  | no       | no     | no             |
| demo       | sí       | sí     | no             |

## Setup

Requiere [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
cd bff
npm install
```

1. **Crear el KV namespace** para los locks de la cola:

   ```bash
   wrangler kv namespace create QUEUE_LOCK
   ```

   Copia el `id` que devuelve y reemplaza `<KV_ID>` en `wrangler.toml`.

2. **Configurar los secretos** (no van en `wrangler.toml`):

   ```bash
   wrangler secret put JWT_SECRET       # cadena aleatoria larga para firmar JWT
   wrangler secret put AIRTABLE_TOKEN   # Personal Access Token de Airtable
   wrangler secret put ANTHROPIC_KEY    # API key de Anthropic
   wrangler secret put OPENAI_KEY       # API key de OpenAI
   # Opcionales:
   wrangler secret put USERS            # JSON: array de {username,name,role,hash}
   wrangler secret put AGENTS           # JSON: map agentId -> systemPrompt
   ```

   Si no defines `USERS`, se usa la lista de usuarios por defecto incluida en el
   código (con las contraseñas actuales del dashboard).

3. **Ajustar variables públicas** en `wrangler.toml`:

   - `AIRTABLE_BASE_ID`: el id de tu base (`appXXXX`).
   - `ALLOWED_ORIGINS`: orígenes permitidos para CORS, separados por coma
     (ej. `https://thelabsolutionscl.github.io`). Si no se define, el Worker
     usa `*` y emite un `console.warn` (no recomendado en producción).
   - `PWD_SALT`: salt de las contraseñas (`thelab.v2:` por defecto).

4. **Deploy**:

   ```bash
   wrangler deploy
   ```

5. **Activar en el dashboard**: setea `BFF_URL` con la URL pública del Worker.

## Seguridad de contraseñas

El hash de contraseña es `sha256hex(PWD_SALT + password)`, la misma convención
que el dashboard actual (`'thelab.v2:' + password`). El JWT se firma con HS256
(HMAC-SHA256) usando `JWT_SECRET`. La verificación de firma es en tiempo
constante.

## IMPORTANTE: rotar los secretos viejos

Las API keys de Airtable, Anthropic y OpenAI que estaban inyectadas en el
cliente deben considerarse **comprometidas**. Una vez que el BFF esté en
producción:

1. **Revoca/rota** los tokens antiguos en cada proveedor.
2. Genera tokens nuevos y cárgalos como secretos del Worker
   (`wrangler secret put ...`).
3. Quita cualquier secreto que siga embebido en `index.html`.

Mientras esos tokens viejos sigan vivos, el riesgo persiste aunque el BFF ya
esté desplegado.
