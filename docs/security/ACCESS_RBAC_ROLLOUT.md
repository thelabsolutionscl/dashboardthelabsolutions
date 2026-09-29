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

Tras configurar Cloudflare y **comprobar realmente la sesión, las reglas
CORS/OPTIONS, los roles y las pruebas SII en certificación**, habilitar en
**GitHub → Settings → Secrets and variables → Actions → Variables** las dos
variables `SII_CUTOVER_VERIFIED=true` y `SII_ACCESS_MODE=true`.
La segunda es una puerta explícita independiente: poner solo
`SII_ACCESS_MODE=true` bloquea el siguiente deploy sin publicar una versión
fiscal a medio configurar. Además, `PROXY_URL` tiene que ser HTTPS en un
subdominio de `thelab.solutions` (por ejemplo
`https://proxy.thelab.solutions`); una URL `workers.dev` de otro sitio,
con path o query, tampoco pasa la puerta de activación. No hacerlo antes
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

## Integración del Worker de leads con Cloudflare Access

El `lead-worker` llama al mismo proxy Anthropic para procesar leads y
administrar campañas. Si se protege el proxy con Access sin migrar esa
comunicación, el proceso queda bloqueado. Por eso ahora existe la ruta
independiente `POST /service/lead/anthropic/v1/messages`: requiere un JWT
**firmado por Access**, con audiencia/emisor válidos y el `common_name`
exacto de un servicio autorizado. No acepta sesiones de personas, la clave
compartida `APP_KEY` ni acceso a Airtable, SII u otras rutas. Comparte
el allowlist de modelos y el presupuesto atómico existente.

### Activación conjunta con la cuenta de Cloudflare

1. Crear un **Service Token dedicado exclusivamente al lead-worker** en
   Zero Trust → Access controls → Service credentials → Service Tokens.
   Registrar el `Client ID` (sufijo `.access`) y guardar el `Client Secret`
   en una ubicación segura. **Nunca** agregarlos a `index.html`,
   variables públicas de Pages ni al repositorio.
2. En la aplicación Cloudflare Access del proxy, agregar una política
   **Service Auth** que incluya solo ese Service Token. Mantener aparte
   la política interactiva de acceso por usuarios.
3. Configurar en el **airtable-proxy** `ACCESS_LEAD_SERVICE_CLIENT_ID`
   con el Client ID exacto. El proxy valida el JWT de servicio por su
   firma RS256, su `aud`, `iss` y `common_name`, incluso si recibe
   solicitudes directamente desde `workers.dev`.
4. Configurar en el **lead-worker** `CF_ACCESS_CLIENT_ID` y
   `CF_ACCESS_CLIENT_SECRET` como secretos; comprobar que
   `AI_PROXY_URL` apunta a `https://proxy.thelab.solutions` o al
   Worker oficial existente, sin rutas ni parámetros adicionales.
   Tras desplegar el proxy y probar la nueva ruta con el token,
   configurar `AI_ACCESS_MODE=true` en el lead-worker.
5. Probar un procesamiento no fiscal con una tarea de lead y verificar
   en Cloudflare que se autoriza únicamente el token de servicio.
   Probar también token ausente, token ajeno, vencido y ruta diferente.
   Si falla, desactivar `AI_ACCESS_MODE` solo durante la transición,
   sin desactivar las protecciones del proxy ni abrir una excepción
   pública de Access.

`keep_vars=true` se encuentra ahora en los archivos Wrangler de los
dos Workers. Así, futuros despliegues de GitHub no borrarán las
variables Access y las configuraciones de servicio agregadas en
Cloudflare, que son independientes de sus secretos cifrados.

Documentación oficial:
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- https://developers.cloudflare.com/workers/wrangler/configuration/

**Este cambio no crea tokens ni activa ninguna política en Cloudflare.**
Las claves, roles reales, validación del SII y retirada final de secretos
del navegador siguen pendientes de la puesta en marcha supervisada.

## Comprobación de activación de solo lectura (GitHub Actions)

El flujo manual **Verify Access rollout (read-only)** permite revisar
configuración antes y después del corte, sin modificar Airtable, llamar a un
modelo ni emitir o consultar documentos en el SII con una sesión autorizada.

Preparación: `PROXY_URL` y `PROXY_KEY` deben estar configurados como
secretos de GitHub Actions. Para validar el acceso entre Workers, añadir
temporalmente los secretos `PREFLIGHT_CF_CLIENT_ID` y
`PREFLIGHT_CF_CLIENT_SECRET` del token dedicado a leads. Los valores nunca
se imprimen. Este duplicado en GitHub solo es necesario para la prueba; se
puede retirar después, manteniendo el original cifrado en Cloudflare.

1. Una vez configurada la política Access, ir a **GitHub → Actions →
   Verify Access rollout (read-only) → Run workflow**, seleccionar
   `before` y ejecutarlo. El flujo comprueba preflight CORS, rechazo de
   sesión ausente, restricción de lectura fiscal y autenticación efectiva
   del servicio de leads.
2. La comprobación firmada envía JSON deliberadamente inválido a la ruta
   restringida del servicio y exige el error de validación **400**. El
   payload es rechazado antes de reservar tokens o llamar a Anthropic;
   nunca debe usarse un DTE para estas pruebas.
3. Después de activar `SII_ACCESS_MODE=true` y desplegar Pages, ejecutar
   el flujo con `post`. Busca en el HTML público la clave fiscal que aún
   esté configurada en el secreto `SII_WORKER_KEY` de GitHub. Hacer esta
   prueba **antes de rotar** la clave antigua; luego rotar coordinadamente
   ambos Workers, limpiar caches y revisar las páginas públicas.
4. La comprobación **no sustituye** abrir el dashboard desde equipos
   distintos y verificar con usuarios `viewer`, `operator`, `finance`
   y `admin`. Si Cloudflare redirige la prueba sin JWT a su login,
   GitHub informa que debe comprobarse manualmente el rechazo directo
   en el Worker. Los flujos de producción SII siguen pendientes de
   certificación y conciliación de folios.

El script solo permite destinos oficiales del proxy, no sigue
redirecciones y no revela respuestas completas ni valores de secretos.

## Portal de clientes: retirar la clave maestra del navegador (fase opt-in)

El puente **`POST /portal-admin/link`** permite a usuarios autenticados con
rol `operator`, `finance` o `admin` generar un enlace firmado. Solo
`admin` puede ejecutar **`POST /portal-admin/revocar`**, que invalida los
enlaces vigentes de un cliente. El proxy verifica la sesión Access,
valida el `clienteId`, limita `dias` a 1–365, exige JSON pequeño y
solo conecta con el `thelab-leads-worker` oficial. No permite rutas,
parámetros ni redirecciones arbitrarias, ni reintenta una revocación incierta.
La clave `X-Portal-Admin-Key` se agrega exclusivamente dentro del proxy;
nunca se devuelve ni se manda desde el navegador en el modo protegido.

Para activar **sin interrumpir el portal existente**, completar estos pasos
junto con la activación general de Cloudflare Access:

1. Configurar en **airtable-proxy** `LEAD_WORKER_URL` con el origen oficial
   `https://thelab-leads-worker.<equipo>.workers.dev/` o el dominio propio
   habilitado (`leads.thelab.solutions` o `portal.thelab.solutions`) y
   `PORTAL_ADMIN_KEY` como secreto cifrado, con el mismo valor que usa
   **lead-worker**. No publicar esa clave en variables de Pages ni en código.
2. Habilitar y probar las cuatro identidades de Cloudflare Access, incluida
   la sesión de `operator`. Un operador debe poder crear un enlace pero no
   revocarlo; `viewer` no puede hacer ninguna de las dos acciones; `admin`
   puede realizarlas ambas. Probar realmente que los enlaces abran en el
   portal, y que revocar un cliente no invalide a los demás.
3. Solo después de estas pruebas, establecer **ambas** variables de GitHub
   Actions: `PORTAL_ACCESS_MODE=true` y
   `PORTAL_CUTOVER_VERIFIED=true`. El workflow de GitHub Pages deniega
   la activación si falta la segunda. Al desplegar, sustituye
   `%%PORTAL_ADMIN_KEY%%` por vacío y enciende el modo protegido. Si Access
   o el proxy falla, el navegador **no regresa** al lead-worker directo.
4. Verificar el artefacto Pages realmente publicado, invalidar service
   workers/cachés y, cuando los equipos funcionen mediante Access, **rotar**
   `PORTAL_ADMIN_KEY` coordinadamente en lead-worker y airtable-proxy.
   Eliminar de GitHub Secrets el antiguo valor publicado.

Sin esas verificaciones, el modo nuevo permanece apagado para conservar la
operación existente; integrar el código **no** equivale a haber retirado la
clave de producción. La credencial maestra de impresoras y el `APP_KEY`
compartido del dashboard siguen pendientes en el P0 de seguridad #306.

## Impresoras: tickets breves por rol, sin secreto maestro publicado (fase opt-in)

El proxy expone exclusivamente `POST /printer/session`, disponible solo para
identidades humanas con Cloudflare Access firmado. Emite un ticket temporal
del Farm Controller mediante el secreto adecuado almacenado **en el proxy**:
`viewer` y `finance` reciben lectura, `operator` puede operar las impresoras
y `admin` puede ejecutar acciones administrativas. Se valida que el
Controller devuelva exactamente el rol solicitado y una expiración breve;
si no lo hace, se rechaza. El dominio de canje se fija a
`https://printers.thelab.solutions` y no se siguen redirecciones.

El frontend ya tiene un modo separado bajo `PRINTER_ACCESS_MODE`. Cuando se
activa, ignora las claves antiguas del HTML y almacenamiento, las borra del
navegador, usa exclusivamente tickets efímeros para cámaras, WebSocket y
operaciones remotas, renueva su sesión y jamás vuelve al token largo ante un
error. El túnel de impresoras queda fijo al dominio oficial. El formulario
«Mi cuenta» deja de aceptar claves y URLs alternativas.

### Activación conjunta, sin cortar producción

1. Confirmar que el iMac corre **Farm Controller** (no el bridge legado
   `server.js` directamente). Debe responder a `POST /farm/session` con
   `ok: true`, `role`, `token` y `expiresAt`. Este proceso acepta tickets
   temporales también en las cámaras y reenvía las peticiones al bridge interno.
2. Generar **tres secretos distintos** para el Farm Controller:
   `BRIDGE_VIEWER_TOKEN`, `BRIDGE_OPERATOR_TOKEN` y
   `BRIDGE_ADMIN_TOKEN`. Configurarlos en el iMac; no sobrescribir ni
   revocar el token de producción actual antes de la prueba. Configurar
   las **mismas tres claves** como `PRINTER_VIEWER_TOKEN`,
   `PRINTER_OPERATOR_TOKEN` y `PRINTER_ADMIN_TOKEN` mediante secretos
   cifrados del **airtable-proxy**. No configurar esos valores en GitHub
   Pages ni en el código.
3. Con Cloudflare Access y los roles activos, verificar el canje a través
   del proxy para un usuario de cada rol. Comprobar en remoto que lectura,
   cámaras y telemetría funcionen con `viewer`, que `operator` pueda
   operar pero no administrar y que solo `admin` tenga controles críticos.
   Probar sesión vencida, ausencia de sesión y claves incorrectas. Verificar
   por separado el modo LAN: no debe alterarse.
4. Solo cuando la prueba anterior resulte correcta, configurar en GitHub
   Actions las dos variables `PRINTER_ACCESS_MODE=true` y
   `PRINTER_CUTOVER_VERIFIED=true`, y desplegar Pages. La segunda es una
   puerta manual obligatoria para impedir un corte accidental. El despliegue
   retira `PRINTER_TUNNEL_TOKEN` del HTML y activa las solicitudes de
   tickets firmados. Si Access falla, las acciones remotas fallan cerradas.
5. Revisar el HTML publicado y los cachés/service workers, validar cámaras,
   telemetría y acciones en dos dispositivos y retirar el token maestro
   anteriormente expuesto en coordinación con el iMac. El token de
   compatibilidad no debe seguir habilitado después del corte definitivo.

**Limitación de seguridad:** un ticket ya expedido conserva su rol hasta que
venza (normalmente 10 minutos), aunque cambie el rol del usuario en Access.
Para revocación urgente, invalidar las sesiones del Farm Controller
reiniciándolo de forma controlada, teniendo en cuenta la continuidad de las
impresiones y los WebSockets. No se afirma despliegue ni pruebas en el iMac
hasta verificarlos de verdad.

## 2026-09-29 — Despliegues independientes por Worker

Durante la corrección del historial de Reportes (#335), el workflow de Cloudflare intentó desplegar también el Worker SII sin cambios en su código. El proxy y el Worker de leads sí se desplegaron; el job SII falló por falta de `SII_WORKER_KEY` en Actions. Este fallo no significa que se haya publicado el Worker tributario ni que el cambio de Reportes dependa de la clave fiscal.

El workflow distingue ahora las rutas modificadas con `git diff` y despacha exclusivamente el Worker afectado (`airtable-proxy/`, `lead-worker/` o `sii-worker/`). Un cambio solo del proxy no dispara SII, preservando sus credenciales y evitando un falso despliegue fiscal. El comando manual de Actions ofrece `all`, `lead`, `proxy` y `sii` como destinos explícitos; conserva `all` como opción por defecto para una ventana de despliegue conjunta controlada. Si solo cambian documentación o el workflow, no se publican Workers innecesarios. Pruebas unitarias validan cada combinación y las condiciones de todos los jobs.

La clave SII de Actions y Cloudflare Access siguen pendientes de la fase manual final. La separación del despliegue no activa por sí misma ninguna integración fiscal ni cambia las variables de seguridad vigentes.

## 2026-09-29 — Cierre de ruta y método para administradores

El P0 incluía una autorización genérica `if (identity.role === 'admin') return true` al comienzo de `accessAllows`. Eso impedía que la matriz RBAC del proxy rechazara rutas inexistentes o no aprobadas para administradores con un JWT válido; también permitía métodos ajenos a una operación (por ejemplo `GET /portal-admin/revocar` o `DELETE /marketing/spend`) hasta que otro bloque los detuviera, y rutas arbitrarias de Airtable podían alcanzar el proxy genérico con el PAT del servidor. Un JWT válido debe conferir permisos sobre recursos declarados, no convertirse en un proxy ilimitado.

El nuevo control exige una identidad de rol conocido y verifica por separado rutas y métodos, **incluido admin**: gastos compartidos `GET/PUT` y consulta de historial `GET`; creación y revocación de enlaces del portal `POST`; emisión SII `POST`, folios de tipos aprobados `GET` y CAF `PUT`; ticket de impresoras exclusivamente `POST /printer/session`; operaciones IA y SEO públicas solo a sus endpoints aprobados; metadatos del esquema únicamente a listado de la base TLS o creación validada de tabla/campo; y tablas Airtable explícitamente listadas, con segmento y record ID canónicos. Rutas ocultas, tablas `tblId`, alias codificados, subrutas desconocidas, métodos fuera de contrato y roles desconocidos quedan denegados antes de usar el PAT. Los permisos por rol existentes para operador, finanzas y lector siguen aplicándose.

Las nuevas regresiones comprueban una matriz de casos permitidos/denegados por ruta y método, así como una sesión **admin con JWT RS256 real de prueba** que recibe 403 ante un endpoint no aprobado. Esto **no implica** que Cloudflare Access esté activado en producción: su dominio, políticas, roles reales, revocación efectiva y pruebas con navegadores siguen agrupados en la fase de configuración final junto con los secretos fiscales.

## 2026-09-29 — Catálogo explícito de tablas usadas por el dashboard

La corrección de la autorización global de administradores exigió contrastar el catálogo de tablas contra el código real de las secciones. La lista inicial de Access omitía tablas que el dashboard ya utiliza: `Automations`, `Agent_Queue`, `Agent_Log`, `Social_Posts`, `Social_Interactions`, `Social_Metrics`, `Newsletter_Campañas`, `Newsletter_Envios` y `Google_Ads_KPIs`. Sin ellas, un administrador firmado habría perdido herramientas de Oficina Virtual, Redes, Newsletter y Google Ads en el momento de activar Cloudflare Access.

Se declaran explícitamente estas nueve tablas en la lista cerrada y, **por ahora, únicamente admin puede acceder a ellas**. No se otorgan permisos de lectura ni escritura nuevos a `viewer`, `operator` o `finance` sobre campañas, colas o registros de agentes: eso requiere definir su visibilidad a nivel de registro y comprobar que no expone información de otros usuarios o clientes. La prueba `tests/access-table-catalog.test.js` extrae llamadas con nombres literales a Airtable desde los módulos activos de Redes, Oficina, Ads, Agentes, Proveedores, Finanzas, Calendario, Máquinas y Correo y falla si una tabla usada no está incluida. También comprueba que la nueva lista no permite nombres desconocidos, subrutas o alias y que conserva las autorizaciones existentes del CRM.

La auditoría del esquema y la matriz de acceso por registro siguen pendientes; esta precaución no activa Access en producción ni amplía la exposición de las claves actuales. Verificar los nueve módulos y los cuatro roles en sesiones reales al final de la auditoría, cuando el dominio de Cloudflare y las identidades estén disponibles.
