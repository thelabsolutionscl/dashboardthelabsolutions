# Calendario compartido fuera de Monitor Sistema

Antes de esta corrección, la vista Calendario dependía del registro `CALENDARIO` dentro de `Monitor Sistema`. Aunque la intención era leer/escribir únicamente ese registro, el navegador necesitaba acceso genérico a la tabla para descubrirlo y actualizarlo. Eso era incompatible con la decisión de mantener `Monitor Sistema` como admin-only, porque la misma columna `Notes` contiene configuraciones internas de otros dominios.

## Nueva ruta

El proxy expone únicamente `GET /shared/calendar` y `PUT /shared/calendar`.

- `viewer`: GET solamente.
- `sales`, `operator`, `finance`, `admin`: GET y PUT.
- POST/PATCH/DELETE no existen para el cliente.
- En modo legado APP_KEY la ruta sigue funcionando durante la migración, para no cortar operación antes del cambio final de Cloudflare Access.

El cliente ya no necesita conocer el recordId de Airtable, llamar `Monitor Sistema`, usar `_monitorUpsert` ni consultar el registro por `_atFetch`. El servidor construye su propia búsqueda exacta de `Name='CALENDARIO'` y solo solicita `Name` y `Notes`.

## Esquema y concurrencia

El contenido permitido está limitado al documento actual `{events,gmap,gmapMts,crmSync}`. Se verificó la forma contra el registro productivo actual sin exponer sus contenidos en logs. La ruta valida tipos, tamaños, fechas, recordatorios, personas, mapas de Google Calendar y metadatos de sincronización. Campos adicionales o payloads que intenten reutilizar la ruta para guardar configuraciones ajenas al calendario se rechazan.

Cada GET devuelve un hash SHA-256 `revision` del documento actual. El PUT debe enviar `expectedRevision`. Las escrituras pasan por una instancia Durable Object dedicada `tls-shared-calendar`; dentro de esa cola se vuelve a leer el registro autoritativo antes de escribir. Si otro equipo cambió el documento, responde `409 CALENDAR_REVISION_CONFLICT` junto con la versión actual segura.

El navegador solo reintenta **una vez** después de ese 409 confirmado: primero fusiona la versión remota con eventos, lápidas, Google mappings y crmSync locales usando la lógica existente. Timeout, 5xx o resultado ambiguo nunca provocan un PUT automático adicional. Después de una escritura exitosa, el Durable Object relee Airtable y exige que el contenido coincida antes de confirmar.

## Límites

Esta etapa migra únicamente `CALENDARIO`. AGENDA, firmas/correos, MachineOps, simulación, compras/precios de proveedores, recompra y otros usos de `Monitor Sistema` siguen requiriendo rutas propias antes del cutover definitivo para usuarios no-admin.

La ruta no sustituye el pendiente de DNS/Cloudflare Access. Mientras Access no esté activado, el APP_KEY legado continúa siendo una credencial compartida de compatibilidad.

Pruebas:
- `tests/access-calendar-shared-route.test.js`
- `tests/calendario-shared-access.test.js`
