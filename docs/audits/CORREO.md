# Auditoría de CORREO

## Alcance

El módulo está compuesto por:

- `index.html`: interfaz del cliente de correo;
- `js/correo.js`: cuentas, credenciales, lectura, composición, adjuntos y vínculos con CRM;
- `js/notify.js`: polling de no leídos;
- `mail-api.php`: IMAP para lectura y Resend/SMTP para envío.

La auditoría revisó autenticación, autorización, secretos, envío, lectura, HTML remoto, adjuntos, límites, idempotencia, cuentas compartidas y trazabilidad.

## Fortalezas comprobadas

- El endpoint usa HTTPS y respuestas `no-store`.
- El frontend aplica timeout de 30 segundos.
- Las lecturas pueden reintentarse, pero los envíos no se reintentan automáticamente.
- El doble clic de envío se bloquea localmente con `_sending`.
- El listado IMAP usa sobres y no descarga todos los cuerpos.
- Los snippets están acotados por cantidad, tamaño y tiempo.
- El visor HTML usa un iframe `sandbox` sin `allow-scripts`.
- El texto plano se escapa antes de renderizarse.
- Hay límites de adjuntos de 15 MB en cliente y 20 MB en servidor.
- La integración registra envíos de cotizaciones y conecta remitentes con CRM.

Estas defensas son valiosas, pero no compensan los bloqueadores críticos siguientes.

## Hallazgos críticos

### 1. Resend envía antes de autenticar la casilla

En `case 'send'`, cuando existe `RESEND_API_KEY`, `mail-api.php` llama a `resend_send(...)` antes de abrir IMAP o verificar `user/pass`.

El POST solo exige que `user` y `pass` no estén vacíos. CORS no es autenticación y puede omitirse realizando la solicitud fuera de un navegador. Por lo tanto, una contraseña falsa puede alcanzar el envío Resend usando una dirección remitente aceptada por el proveedor.

**Corrección requerida:** autenticar primero contra IMAP o, preferiblemente, reemplazar la contraseña de buzón por una sesión backend corta emitida después de una autenticación válida. Después, autorizar explícitamente la casilla remitente.

### 2. HTML recibido sale del sandbox al responder o reenviar

La vista normal coloca `body_html` dentro de un iframe aislado. Sin embargo, `reply()` y `forward()` pasan `m.body_html` a `openCompose()`, que lo asigna mediante `mailCmpBody.innerHTML` en el DOM principal.

Así, un correo malicioso puede introducir HTML activo, atributos de evento, formularios, enlaces engañosos o recursos remotos dentro del dashboard cuando el usuario responde o reenvía.

**Corrección requerida:** sanitizar con una política estricta antes de insertar HTML en el editor. El contenido citado debería convertirse a HTML permitido o texto seguro.

### 3. Contraseñas de correo en texto plano dentro de `localStorage`

Cada contraseña se guarda bajo `thelab_mail_pass_<cuenta>` y permanece indefinidamente. Cualquier XSS en el dashboard, extensión con acceso al sitio, persona con acceso al mismo perfil del navegador o script comprometido puede leer todas las credenciales almacenadas.

Además, la contraseña completa viaja al endpoint en cada operación.

**Corrección requerida:** sesión backend corta, cookies `HttpOnly`, rotación, expiración e invalidación. El navegador no debe conservar la contraseña del buzón.

### 4. No existe limitación de envío en servidor

El “freno” de correos vive en `localStorage`. Se puede borrar, modificar o evitar llamando directamente a `mail-api.php`. Tampoco existe una cuota por cuenta, IP, usuario, tenant o ventana temporal en el backend.

**Corrección requerida:** rate limit autoritativo con respuesta 429, límites diferenciados para manual/automatizado y alertas por comportamiento anómalo.

## Hallazgos altos

### 5. IMAP desactiva la validación del certificado TLS

La conexión usa `/imap/ssl/novalidate-cert`. El tráfico va cifrado, pero el cliente no verifica correctamente la identidad del servidor, debilitando la protección frente a intermediarios.

Debe corregirse el certificado/cadena del servidor y retirar `novalidate-cert`.

### 6. Cuentas compartidas y remitentes sin autorización central

`hola@thelab.solutions` aparece automáticamente en el selector y el usuario puede agregar cualquier dirección con formato válido. No existe una asignación backend que indique qué persona o rol puede leer o enviar desde cada casilla.

`postAs()` además cae silenciosamente a la cuenta activa cuando falta la contraseña solicitada. Esto puede enviar desde una identidad distinta a la esperada por un agente o flujo CRM.

### 7. Firmas y URLs insertadas no se sanitizan

Las firmas pueden editarse como HTML crudo, persistirse en `localStorage` y Airtable, recuperarse y volver a insertarse mediante `innerHTML`.

`sigInsertImage()` e `insertImagePrompt()` interpolan una URL directamente dentro de un atributo HTML. Se necesita sanitización, escape de atributos y una política que permita solo `https:` y, cuando corresponda, hosts aprobados.

### 8. Imágenes remotas y tracking pixels

El iframe bloquea scripts, pero permite que imágenes y otros recursos remotos se carguen automáticamente. Abrir un correo puede revelar IP, agente de usuario, horario de lectura y parámetros únicos al remitente.

Se recomienda bloquear recursos remotos por defecto y ofrecer “Cargar imágenes” por mensaje o remitente confiable.

### 9. Validación incompleta de destinatarios y remitentes en backend

La validación de `To`, `CC` y `BCC` ocurre principalmente en JavaScript. El servidor solo comprueba que `to` y `subject` no estén vacíos.

Debe validar sintaxis, cantidad de destinatarios, tamaño, caracteres de control y políticas de dominio. `From` debe salir de una allowlist vinculada a la sesión autenticada.

### 10. Sin idempotencia de envío

No se reintenta `send`, lo que reduce duplicados, pero un timeout deja al usuario sin saber si Resend aceptó el mensaje. Reintentar manualmente puede duplicarlo.

Debe generarse una idempotency key por envío, almacenarse en servidor y conservar el identificador devuelto por Resend.

## Hallazgos medios

- La descarga de adjuntos carga el archivo completo en memoria y no impone tamaño máximo en `action=attachment`.
- No hay advertencia reforzada para ejecutables, HTML, SVG, documentos con macros u otros formatos activos.
- El backend acepta cuerpo, asunto y lista de destinatarios sin límites explícitos propios.
- La búsqueda IMAP construye el criterio con `addslashes`; conviene una codificación específica para criterios IMAP.
- Firmas, destinatarios históricos y preferencias comparten Airtable/localStorage sin un modelo claro de permisos por casilla.
- El frontend y el backend no verifican automáticamente que ejecutan el mismo `MAIL_API_BUILD`.
- La auditoría de envíos es insuficiente: debe registrar cuenta, actor, fecha, resultado, proveedor e idempotency key sin almacenar contraseña ni cuerpo completo.

## Arquitectura recomendada

1. Autenticar al usuario del dashboard contra un backend propio.
2. Autorizar cuentas por usuario/rol en una tabla de asignaciones.
3. Emitir una sesión corta y segura; nunca devolver ni persistir la contraseña IMAP.
4. Validar la casilla antes de cualquier envío Resend.
5. Aplicar rate limit, cuota, idempotencia y auditoría en servidor.
6. Sanitizar HTML entrante, firmas, plantillas y contenido citado.
7. Bloquear recursos remotos por defecto.
8. Separar credenciales IMAP del proveedor transaccional de salida.
9. Mantener estados de envío: preparado, aceptado por proveedor, guardado en Enviados, fallido o incierto.

## Prioridad de corrección

1. Bloquear envío Resend sin autenticación válida.
2. Evitar XSS al responder/reenviar y al cargar firmas.
3. Retirar contraseñas de `localStorage`.
4. Agregar autorización de casillas y rate limit backend.
5. Validar TLS, destinatarios, adjuntos e idempotencia.
6. Bloquear tracking remoto y completar auditoría.

## Cobertura agregada

- `tests/correo-wiring.test.js`
- `.github/workflows/correo-audit.yml`

Las pruebas activas protegen el cableado y las defensas existentes. Los defectos confirmados se mantienen como diagnósticos `todo` hasta que exista una implementación segura verificable.

## Criterios de aceptación

1. Ningún envío ocurre antes de autenticar y autorizar la casilla.
2. Una contraseña falsa nunca puede producir un envío Resend.
3. El navegador no almacena contraseñas IMAP.
4. Responder, reenviar o cargar una firma no puede ejecutar HTML arbitrario.
5. Recursos remotos están bloqueados por defecto.
6. Rate limit e idempotencia viven en servidor.
7. Cada usuario solo puede usar las casillas asignadas por RBAC.
8. `postAs` falla de forma explícita si no puede usar el remitente solicitado.
9. IMAP valida el certificado TLS.
10. Destinatarios, cuerpo y adjuntos tienen límites y validación backend.
11. Los envíos generan una auditoría mínima y trazable.
12. Los diagnósticos `todo` se convierten en pruebas obligatorias al corregirse.
