# Correos compartidos fuera de Monitor Sistema

Las firmas, el historial de destinatarios y las plantillas compartidas ya no
requieren que el navegador lea o escriba la tabla completa `Monitor Sistema`.

## Ruta dedicada

El proxy expone `GET/PUT /shared/mail` con tres recursos:

- `resource=signature&account=<casilla>`
- `resource=sent-addresses&account=<casilla>`
- `resource=templates`

Las respuestas sólo contienen el recurso solicitado, su revisión SHA-256 y un
indicador de existencia. Nunca exponen el mapa completo de casillas, el
`recordId` de Airtable ni otros registros de `Monitor Sistema`.

## Autorización por casilla

Con Cloudflare Access activo:

- cada identidad puede usar su propia casilla;
- `hola@thelab.solutions` es la casilla compartida disponible para los roles
  firmados;
- `pagos@thelab.solutions` queda limitada a Finanzas y Admin;
- Admin puede operar otras casillas `@thelab.solutions`;
- `viewer` es sólo lectura;
- plantillas son globales, legibles por todos los roles firmados y modificables
  por sales/operator/finance/admin.

El modo legado conserva una casilla explícita validada mientras Access aún no
está activo, para no romper la fase previa al cutover.

## Concurrencia

Cada combinación recurso+casilla tiene revisión propia. Las escrituras pasan por
el Durable Object `tls-shared-mail`, que relee Airtable dentro de una cola y
reemplaza sólo la clave autorizada. Dos casillas pueden actualizar el mismo
registro `MAIL_SENT_ADDRESSES` sin falsos conflictos ni pérdida cruzada.

Las plantillas usan el mismo CAS. Ante un 409 confirmado, el navegador calcula
el delta local respecto de la versión que editó y lo reaplica sobre la versión
remota: una alta concurrente no desaparece y un borrado local no elimina altas
hechas por otro equipo. Timeout/5xx nunca se reintenta a ciegas.

## Compatibilidad

La forma real de `MAIL_SIGNATURES` y `MAIL_SENT_ADDRESSES` fue verificada
en Airtable antes del cambio. No se migran ni reescriben datos durante la
auditoría. `MAIL_TEMPLATES` no existía en el snapshot verificado y sólo se
creará cuando haya plantillas que publicar.
