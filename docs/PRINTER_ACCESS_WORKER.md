# Printer Access Worker — sesiones cortas para MÁQUINAS

## Objetivo

El dashboard público no debe contener `BRIDGE_TOKEN`, `BRIDGE_ADMIN_TOKEN`, `BRIDGE_OPERATOR_TOKEN` ni `BRIDGE_VIEWER_TOKEN` permanentes. El navegador obtiene una sesión HMAC con vigencia corta después de autenticarse mediante Cloudflare Access.

Flujo:

1. El usuario abre `dashboard.thelab.solutions`.
2. `js/maquinas-farm-controller.js` solicita `GET https://printer-access.thelab.solutions/session`.
3. Cloudflare Access exige identidad y entrega `Cf-Access-Jwt-Assertion` / `CF_Authorization`.
4. El Worker verifica criptográficamente ese JWT contra los certificados públicos de Access y su Audience.
5. El Worker asigna `viewer`, `operator` o `admin` y firma una sesión de 5 minutos con `FARM_SESSION_SECRET`.
6. `farm-auth-preload.js` valida la sesión y la convierte internamente al token local del rol. El token permanente nunca sale del host del Farm Controller.

## Configuración de Cloudflare Access

Crear una aplicación Access para `printer-access.thelab.solutions/session`. Guardar su Audience en `CLOUDFLARE_ACCESS_AUD` y el dominio Zero Trust (`empresa.cloudflareaccess.com`) en `CLOUDFLARE_TEAM_DOMAIN`.

El Worker rechaza assertions que no cumplan firma RS256, `kid`, Audience, issuer y vigencia. No confía en un header de email enviado por el cliente.

## Secreto compartido

En el host del Farm Controller existe:

`$FARM_DATA_DIR/session-secret`

Si no existe, `farm-auth-preload.js` lo genera con permisos `0600`. Ese valor debe configurarse en Cloudflare como secreto `FARM_SESSION_SECRET`:

```bash
cd printer-access-worker
npx wrangler secret put FARM_SESSION_SECRET
```

No pegarlo en el dashboard ni versionarlo.

## Roles

Configurar como secretos del Worker listas separadas por coma:

```bash
npx wrangler secret put ADMIN_EMAILS
npx wrangler secret put OPERATOR_EMAILS
```

Usuarios autenticados que no estén en esas listas reciben `viewer`.

## Otros secretos

```bash
npx wrangler secret put CLOUDFLARE_TEAM_DOMAIN
npx wrangler secret put CLOUDFLARE_ACCESS_AUD
```

Luego:

```bash
npx wrangler deploy
```

## Migración

Durante el despliegue inicial los tokens largos aún son aceptados por Farm Controller para CLI/rollback. El deploy del dashboard deja de hornear `PRINTER_TUNNEL_TOKEN`. Una vez confirmado el Worker, rotar los tokens permanentes del controller.

## Validación

En navegador:

```js
FarmSessionAuth.status()
```

Debe indicar `mode: "short-session"` y un `expiresAt` cercano. El token no se guarda en `localStorage`.
