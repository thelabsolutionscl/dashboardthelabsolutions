# Activación controlada de identidad y permisos (Cloudflare Access)

La integración se incluye en código, **pero no está activada** mientras no se
configuren las variables Access del `airtable-proxy`. No confundir haber
integrado el código con haber protegido el dashboard publicado: la clave
compartida `APP_KEY` del frontend sigue siendo visible en modo legado.
Se necesita una transición conjunta de dominio, identidad, permisos, frontend
y rotación de credenciales. No modificar secretos durante esta fase.

## Protección incluida

- El proxy valida la firma RS256 del JWT `Cf-Access-Jwt-Assertion` contra
  `https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs`, además de
  emisor, aplicación (AUD), caducidad e identidad con rol explícito.
- Roles: `viewer` (lectura no financiera), `operator` (lectura y escritura
  operativa permitida), `finance` (datos comerciales y Facturas),
  `admin` (administración). El servidor deniega tablas, operaciones y rutas
  desconocidas sin un permiso explícito. Cualquier ruta o tabla que se añada
  en el futuro requiere revisión de los permisos.
- El rol se configura por identidad de correo verificada. Un JWT válido de
  otra aplicación, otro equipo o un correo sin rol no concede acceso.
- Si empieza a configurarse Access pero falta una variable, el proxy devuelve
  **503** en vez de volver a aceptar la clave compartida.
- Un registro de auditoría de las mutaciones autorizadas incluye identidad,
  rol, método y ruta (no carga útil, secretos ni documentos).

## Preparación para la activación, cuando se hagan todas las claves juntas

1. Crear una aplicación Cloudflare Access para el hostname del proxy y una
   política de acceso únicamente para usuarios autorizados. Configurar el
   navegador para mantener su sesión ante peticiones al proxy; probar OPTIONS
   y CORS desde el dominio real del dashboard. **No activar aún**: el frontend
   actual no implementa el inicio de sesión de Access.
2. En `airtable-proxy`, establecer **en conjunto** `ACCESS_ENFORCE=true`,
   `ACCESS_TEAM_DOMAIN=https://<equipo>.cloudflareaccess.com`,
   `ACCESS_AUD=<audiencia de la aplicación>` y `ACCESS_ROLE_MAP` como JSON,
   por ejemplo `{"finance@example.com":"finance","operador@example.com":"operator"}`.
   Los correos de ejemplo deben sustituirse por los reales. Guardar el mapa
   mediante las variables protegidas de Cloudflare, no en GitHub.
3. Antes de retirar la clave existente, migrar el frontend para usar la
   sesión Access y pasar por el proxy las llamadas privilegiadas actualmente
   hechas directamente a SII, portal y máquinas. Completar las pruebas de
   matriz de roles con los nombres de tablas reales, altas, bajas, aprobaciones
   y operaciones físicas. Los roles de este primer corte **solo** protegen
   el proxy Airtable/IA, no otros Workers.
4. Ensayar la transición con una cuenta por rol, otra sin rol y una sesión
   vencida, desde dos equipos. Verificar los endpoints GET y mutaciones
   del dashboard y que solicitudes con Origin falsificado y `X-App-Key`
   copiada no tengan acceso. Comprobar que los folios pendientes se concilien
   en certificación SII antes de probar emisión nueva.
5. Una vez verificada la ruta nueva, eliminar secretos maestros del HTML
   y del workflow GitHub Pages, revocar/rotar credenciales antiguas y
   verificar el código fuente del sitio publicado y sus caches.

En Cloudflare, proteger también el acceso directo a `workers.dev`. El
servidor verifica por sí mismo la firma del JWT y su audiencia aun cuando una
ruta de la red de distribución no esté protegida por Access. `/health`
del proxy permanece público, sin información personal.

**Importante:** esta etapa no es una afirmación de seguridad de producción
ni habilita el despliegue fiscal por sí sola. Requiere pruebas reales
y reconciliación de CAF/folios del SII.

## Puerta SII preparada (todavía no activa)

El proxy expone un puente privilegiado SOLO cuando ya existe una identidad
Cloudflare Access verificada. `POST /sii/emit` y
`GET /sii/folio/:tipo` requieren `finance` o `admin`;
`PUT /sii/caf` exige `admin`. Si no hay Access activo el puente responde
503 aunque alguien conozca la `APP_KEY` pública. Todas las rutas SII
desconocidas o que intenten redirecciones se rechazan.

En la futura configuración única de secretos, guardar en Cloudflare
`SII_WORKER_URL` como URL HTTPS del Worker oficial (dominio
`.workers.dev` o `sii.thelab.solutions`) y `SII_WORKER_KEY` como
secreto privado **solo del proxy**. No inyectar esta última al HTML al
migrar el formulario. El servidor envía el header de autenticación al
Worker fiscal; el navegador recibe únicamente la respuesta JSON. Una
pérdida de respuesta es resultado incierto: no reenviar automáticamente,
conciliar el folio primero.

Migrar `emitirDTE`, la consulta de folios y la carga de CAF al puente
`/sii/*` solo después de activar Access y probar la sesión con el
frontend. El Worker fiscal sigue requiriendo su propia clave y las reservas
durables existentes: el proxy no sustituye la protección idempotente.

## Formulario de emisión conectado al puente Access (fase opt-in)

Este cambio prepara el frontend y las rutas de sesión, sin activarlos
automáticamente en la cuenta existente. Antes de habilitarlo, configurar
en **airtable-proxy** los cuatro valores de Access descritos arriba, más
`SII_WORKER_URL` y `SII_WORKER_KEY` como secretos del propio proxy. Proteger
el hostname del proxy con Cloudflare Access y probar que las cookies funcionen
desde `https://dashboard.thelab.solutions`.

Tras configurar Cloudflare, habilitar en **GitHub → Settings → Secrets and
variables → Actions → Variables** `SII_ACCESS_MODE=true`. No hacerlo antes
de las comprobaciones previas: el próximo deploy de GitHub Pages pasará el
formulario de Finanzas al proxy para emisión, consulta de folios y carga de
CAF, y **dejará de insertar SII_WORKER_KEY en el HTML**. Si hay un error
de sesión, red o configuración, el formulario falla cerrado, nunca vuelve al
Worker fiscal directo. En la ventana de configuración SII aparece un botón
para iniciar sesión en Access y la prueba de conexión muestra correo y rol;
ya no se puede cambiar manualmente la URL fiscal protegida.

### Pruebas previas obligatorias

- Habilitar primero el proxy en Cloudflare y revisar el login desde el
  navegador con una cuenta `finance` y otra `admin`. Desde el dominio del
  dashboard, `GET /access/me` debe devolver una identidad con rol válido.
- Proteger el hostname del proxy, incluidos `workers.dev` y dominios
  alternativos cuando apliquen. En la app Access, configurar el bypass de
  preflight **OPTIONS** o sus reglas CORS equivalentes; el proxy admite
  únicamente los dos orígenes definidos en código y envía
  `Access-Control-Allow-Credentials: true`.
- Con el entorno SII de **certificación**, validar el acceso `finance`
  a `POST /sii/emit` y `GET /sii/folio/:tipo`, acceso `admin` a
  `PUT /sii/caf`, rechazo a `viewer/operator` y rechazo a usuarios
  no autenticados. Concilia CAF/folios existentes ANTES de emitir.
- Activar la variable de GitHub y verificar en el artefacto publicado que
  el HTML carece del secreto SII; invalidar service workers y caches,
  revisar las sesiones de todos los equipos y rotar la clave que estuvo
  en la versión pública. Rotar el secreto en Worker fiscal y proxy
  coordinadamente, nunca uno sin el otro.
- Las claves `PORTAL_ADMIN_KEY`, `PRINTER_TUNNEL_TOKEN` y la clave pública
  compatible `APP_KEY` **siguen siendo otra tarea abierta**. No declarar el
  dashboard protegido en su totalidad hasta migrar portal y máquinas y
  retirar esas credenciales del frontend.

## Bloqueo de cookies corregido antes de encender Access (PR #310)

El navegador ahora envía las cookies de Cloudflare Access en todas las rutas
centrales del proxy: lectura/escritura de CRM, Claude, KAI, análisis de gasto
y generación de imágenes. La inclusión de cookies queda limitada al origen
y prefijo configurado del proxy; la conexión directa a Airtable u otro dominio
no recibe esas credenciales. La matriz de RBAC también incluye las tablas
operativas usadas en el dashboard: `Monitor Sistema` y `Proveedores`;
`Reportes` queda restringida al equipo de Finanzas y administradores.

**Cloudflare requiere configuración real antes de activar el switch:**
- Usar preferentemente un hostname del mismo sitio, como
  `proxy.thelab.solutions`, en lugar de `workers.dev`. Las cookies de un
  dominio de terceros pueden bloquearse desde el dashboard.
- Cloudflare Access suele bloquear `OPTIONS` antes de llegar al Worker.
  En la app Access, configurar *Bypass OPTIONS requests to origin* o la
  respuesta CORS de preflight de Access, **sin omitir** la validación JWT del
  Worker para las operaciones reales.
- Entrar primero al hostname del proxy mediante el botón de sesión de Finanzas
  y volver al dashboard. Una sesión en el dominio de la app y la configuración
  de cookies correcta son necesarias para las solicitudes autenticadas.
- Documentación: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/

Las pruebas automatizadas solo cubren las rutas y el código. Los bloqueos de
cookies del navegador, la política Access, el SII y los secretos del entorno
requieren una prueba real de extremo a extremo antes de activar
`SII_ACCESS_MODE=true`.
