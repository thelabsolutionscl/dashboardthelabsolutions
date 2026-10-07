# Auditoría de CORREO

## Estado

Auditoría funcional #107 cerrada en código.

El módulo queda dividido en tres capas:

1. **Cliente `js/correo.js`**: interfaz, sanitización, composición y compatibilidad temporal.
2. **Proxy Access**: identidad individual, autorización de casillas y sesión corta del buzón.
3. **`mail-api.php`**: IMAP, Resend, límites, idempotencia, auditoría y validación de adjuntos.

La activación productiva del proxy/Cloudflare Access y el despliegue de la versión nueva de `mail-api.php` continúan agrupados para el cierre final de #306.

## Autenticación y sesión

El navegador ya no persiste contraseñas IMAP en `localStorage` ni `sessionStorage`.

Cuando Cloudflare Access está activo:

- `GET /mail/accounts` devuelve exclusivamente las casillas autorizadas para la identidad firmada;
- `POST /mail/session` recibe la clave una sola vez, valida IMAP y crea una sesión backend de 4 horas;
- `POST /mail/rpc` ejecuta las acciones posteriores sin que el navegador vuelva a transportar la contraseña;
- la sesión expirada devuelve `MAIL_SESSION_REQUIRED`;
- `DELETE /mail/session` permite invalidarla explícitamente.

Antes del cutover de #306 existe compatibilidad temporal solo en memoria de la pestaña. Esa clave no se escribe en Web Storage y desaparece al recargar/cerrar.

## Autorización de casillas

Las casillas compartidas ya no se agregan automáticamente en el cliente.

El proxy construye la lista desde:

- la casilla propia de la identidad Access, si pertenece a `@thelab.solutions`;
- `MAIL_SHARED_ACCOUNT_MAP`, una allowlist server-side que puede conceder una casilla a roles o correos concretos.

`hola@thelab.solutions` no tiene trato especial en el frontend ni en el Worker.

`postAs()` falla explícitamente si:

- la casilla no está autorizada; o
- la sesión de esa casilla no existe/expiró.

Nunca cambia silenciosamente a otro remitente.

## HTML y XSS

Responder y reenviar pasan el HTML recibido por `_sanitizarCita()` antes de insertarlo en el editor principal.

Firmas y contenido compartido pasan por una allowlist separada `_sanitizarFirma()`, que filtra:

- tags activos;
- atributos peligrosos;
- estilos con `url()`, `expression`, `javascript:`, `@import`, etc.;
- URLs no HTTPS.

Las imágenes que agrega manualmente el usuario se crean mediante nodos DOM y solo aceptan URLs HTTPS sin credenciales embebidas.

## Tracking remoto

El visor mantiene iframe sandbox sin scripts.

Además:

- las imágenes remotas se eliminan por defecto del HTML mostrado;
- aparece una acción explícita **Cargar imágenes remotas**;
- al cargarlas se aplica `referrer=no-referrer`;
- responder/reenviar no vuelve a habilitar imágenes remotas automáticamente.

## Envío

Antes de Resend:

1. se valida origen/método y límites de payload;
2. se valida la casilla `@thelab.solutions`;
3. se valida IMAP;
4. se reserva idempotencia;
5. se reserva cuota;
6. recién entonces se llama a Resend.

Una contraseña falsa no puede alcanzar Resend.

## Idempotencia

Cada envío genera `idempotency_key`.

`mail-api.php` mantiene una reserva atómica de 24 horas por casilla + clave:

- primer intento: `pending`;
- resultado final: `done` con respuesta mínima;
- repetición de una clave completada: devuelve el mismo resultado sin reenviar;
- repetición mientras está en curso: 409.

La reserva está en el servidor, no en el navegador.

## Cuota

La cuota de envío sigue siendo autoritativa en servidor:

- predeterminado: 200 envíos/casilla/hora;
- configurable con `MAIL_SEND_HOURLY_LIMIT`;
- serializada con `flock`;
- 429 + `Retry-After` al superar el límite.

## Auditoría

Cada intento de envío deja un evento mínimo en servidor con:

- timestamp;
- hash de casilla;
- hash de IP;
- resultado;
- proveedor;
- ID del proveedor;
- hash de idempotency key;
- cantidad de destinatarios.

No guarda:

- contraseña;
- cuerpo;
- asunto;
- direcciones de destinatarios.

Los envíos que pasan por el proxy también generan auditoría operativa.

## Resend

El ID retornado por Resend se conserva en la respuesta como `provider_id`.

Estados:

- `accepted`: Resend confirmó y entregó ID;
- `failed_or_uncertain`: respuesta de error o resultado no confiable;
- `rate_limited`: bloqueado antes del proveedor.

El SMTP compartido continúa deshabilitado como fallback.

## TLS IMAP

Todas las conexiones usan:

`/imap/ssl/validate-cert`

No existe `novalidate-cert`.

## Destinatarios y límites

El backend valida de forma independiente:

- To/CC/BCC;
- máximo 50 destinatarios;
- asunto máximo 250 bytes;
- nombre From máximo 120;
- cuerpo HTML máximo 2 MiB;
- máximo 10 adjuntos;
- máximo 20 MiB decodificados.

## Adjuntos activos

Además de los límites de tamaño, el backend bloquea tipos ejecutables/activos, entre otros:

- EXE/COM/BAT/CMD/SCR/PS1/VBS/JS/JAR/MSI;
- HTML;
- SVG;
- DOCM/XLSM/PPTM.

La política se aplica al envío y a la descarga desde IMAP.

## Build y despliegue

`MAIL_API_BUILD` es:

`2026-10-07-mail-session-idempotency`

`json_out()` agrega el build a todas las respuestas JSON, permitiendo detectar un cPanel desfasado.

## Cobertura obligatoria

`tests/correo-wiring.test.js` ya no contiene diagnósticos TODO para los hallazgos de #107.

El workflow Correo valida también:

- `airtable-proxy/src/worker.js`;
- `airtable-proxy/src/access-auth.js`;
- `mail-api.php`;
- módulos JS de correo;
- smoke global.

## Pendiente externo

No confundir **código mergeado** con **producción activada**.

Para el cierre final de #306 aún corresponde:

- desplegar el Worker/proxy actualizado;
- activar/configurar Cloudflare Access;
- definir `MAIL_SHARED_ACCOUNT_MAP`;
- desplegar el `mail-api.php` nuevo en cPanel;
- verificar el build público;
- probar IMAP TLS real;
- probar sesión, expiración, casillas autorizadas, 429 e idempotencia desde los equipos reales.
