# Auditoría de PROVEEDORES

## Estado

Auditoría funcional #108 cerrada en arquitectura y datos.

El módulo deja de tratar el nombre del proveedor y los blobs JSON del navegador como fuente de verdad. La identidad autoritativa es el **record ID de Airtable**, expuesto además como `Supplier ID = RECORD_ID()`.

La implementación conserva compatibilidad de lectura con datos locales antiguos, pero las nuevas operaciones se escriben como registros individuales.

## Modelo de datos autoritativo

### Proveedores

Tabla existente `Proveedores`.

Cambios:

- campo fórmula `Supplier ID` = `RECORD_ID()`;
- nombre queda como etiqueta visible, no como identidad;
- reputación agregada se deriva desde evaluaciones;
- eliminación destructiva se bloquea cuando existen dependencias;
- restaurar cambia `Estado` en el mismo record, conservando identidad.

### SupplierApplications

Las postulaciones públicas ya no crean directamente un proveedor.

Campos principales:

- Application ID;
- nombre, contacto, email, teléfono, RUT, ubicación;
- categoría/productos/mensaje;
- estado;
- idempotency key;
- fecha de postulación;
- responsable/fecha/motivo/evidencia de revisión;
- enlace opcional al proveedor convertido.

Flujo:

1. `POST /proveedor` mantiene honeypot, Turnstile y rate limit;
2. normaliza RUT/email/nombre;
3. pasa por `SupplierApplicationGuard`;
4. si ya existe un proveedor, devuelve ese mismo `supplierId`;
5. si ya existe una postulación equivalente, reutiliza esa fila;
6. de lo contrario crea una sola `SupplierApplication`;
7. el dashboard muestra las postulaciones pendientes;
8. **Convertir a proveedor** vuelve a deduplicar;
9. si existe proveedor, solo vincula la postulación;
10. si no existe, crea el proveedor mediante el guard idempotente del proxy;
11. la postulación queda `Convertida` y se genera una evaluación/auditoría.

La ausencia de `PUBLIC_LEAD_KEY` o `TURNSTILE_SECRET` queda señalada en logs del Worker.

## Creación manual idempotente

El navegador ya no crea proveedores con un POST directo susceptible a resultados ambiguos.

Ruta:

`POST /supplier/create`

El Worker:

- exige Cloudflare Access;
- restringe roles;
- valida campos con allowlist;
- serializa por identidad en Durable Object;
- comprueba RUT/email/nombre antes de crear;
- conserva el resultado de la creación;
- un retry con la misma identidad devuelve el mismo proveedor;
- ante outcome incierto, el retry vuelve a consultar Airtable antes de crear.

## Pedidos

Se agregó el campo enlazado `Pedidos.Proveedores` hacia `Proveedores`.

El dashboard prioriza esta relación real y solo usa el texto legacy `Proveedor` como migración de compatibilidad.

### Migración realizada

Solo había dos Pedidos existentes con proveedor textual:

- `recM96phAH7RQzcor`: quedó enlazado a tres proveedores reales;
- `recQnXmVLICp4mLsZ`: quedó enlazado a un proveedor real.

Los demás pedidos no tenían proveedor informado y se dejaron intactos. No se adivinaron relaciones.

## SupplierPrices

Tabla estructurada con una fila por proveedor/ítem/vigencia.

Guarda:

- supplierId y link al proveedor;
- SKU/material y descripción;
- moneda;
- unidad;
- precio neto;
- impuesto/exención;
- mínimo de compra;
- vigencia;
- documento fuente;
- actor y fecha;
- estado activo.

Los precios nuevos ya no escriben `PRECIOS_PROV` como blob.

Los blobs locales antiguos se mantienen solo como fallback de lectura para equipos que todavía los tengan.

## PurchaseOrders

Tabla autoritativa de OC.

Guarda:

- N° OC;
- supplierId/link;
- estado;
- fecha;
- moneda;
- condiciones de pago;
- neto/impuesto/total;
- autor;
- aprobador;
- destinatario;
- fechas de aprobación/envío/aceptación/cierre;
- idempotency key;
- revisión.

## PurchaseOrderItems

Cada ítem de OC es una fila independiente con:

- SKU/material;
- descripción;
- cantidad;
- unidad;
- moneda;
- precio neto unitario;
- IVA/exención;
- cantidad recibida;
- estado de recepción;
- documento fuente.

## PurchaseOrderEvents

Historial inmutable de eventos y cambios de estado:

- estado anterior/nuevo;
- actor;
- fecha;
- motivo;
- evidencia;
- revisión.

## Correlativo OC

`OC-AAAA-NNN` ya no se calcula con `max + 1` en el navegador.

`POST /supplier/purchase-order/reserve` usa un Durable Object y contador serializado por año.

Dos equipos no pueden reservar el mismo número.

Los huecos de numeración por una creación abortada son preferibles a duplicar un correlativo.

## Ciclo de OC

Estados permitidos:

`Borrador → Aprobación → Aprobada → Enviada → Aceptada → Recibida parcial/total → Facturada → Pagada → Cerrada`

También existen retornos/control de cancelación donde corresponde.

Las transiciones se realizan por:

`POST /supplier/purchase-order/transition`

El Worker:

- serializa por OC;
- exige `expectedState` + `expectedRevision`;
- relee Airtable;
- responde 409 si otro equipo ya modificó la OC;
- actualiza estado/revisión;
- crea `PurchaseOrderEvents`;
- si el evento de auditoría no puede escribirse, conserva un evento pendiente en Durable Object y falla explícitamente.

## Envío real de OC

Cambiar una OC a `Enviada` no modifica la etiqueta directamente.

Flujo:

1. la OC debe estar `Aprobada`;
2. se abre el módulo Correo con destinatario y detalle completo de la OC;
3. el correo usa idempotency key estable `supplier-po-<recordId>`;
4. `mail-api`/Resend confirma el envío;
5. recién entonces `supplierPoMarkSent()` solicita la transición a `Enviada`;
6. el evento registra la referencia/ID de Resend.

Si el correo se confirma y el registro de estado falla, reintentar conserva la misma idempotency key y no vuelve a entregar el mensaje.

La OC dispone además de documento imprimible con opción **Imprimir / Guardar PDF**.

## Recepción, factura y pago

La recepción se registra por ítem:

- cantidad pedida;
- cantidad recibida;
- Pendiente / Parcial / Recibido.

El estado general avanza a `Recibida parcial` o `Recibida total`.

`Facturada` y `Pagada` exigen una referencia/evidencia (por ejemplo, número de factura o comprobante), que queda en el evento auditable.

## Gasto real por proveedor

Se eliminó el uso de `Pedidos.Monto total (CLP)` como si fuera gasto del proveedor.

La ficha muestra desde PurchaseOrders:

- **comprometido**;
- **recibido**;
- **pagado**.

El revenue de venta al cliente no se usa como costo de proveedor.

## SupplierEvaluations

Cada evaluación conserva:

- supplierId/link;
- estado anterior/nuevo;
- motivo;
- evidencia;
- responsable;
- fecha;
- calidad;
- puntualidad;
- precio;
- respuesta;
- incidentes;
- notas.

El usuario ya no edita directamente la reputación agregada.

La reputación se deriva de las dimensiones históricas y penalización por incidentes; luego puede cachearse en `Proveedores.Reputación` para visualización.

Aprobar/rechazar una evaluación exige motivo y evidencia.

## SupplierCategories

Categorías, orden y color ya tienen tabla compartida.

El localStorage queda solo como fallback temporal.

Renombrar una categoría:

- migra los registros de proveedores afectados;
- mantiene el orden/configuración compartida.

Eliminar una categoría en uso está bloqueado. Una categoría sin uso se archiva.

## Eliminación y restauración

`deleteProveedor` comprueba:

- Pedidos;
- SupplierPrices;
- PurchaseOrders;
- PurchaseOrderItems;
- SupplierEvaluations;
- relaciones reversas disponibles.

Con dependencias, solo permite archivar como `Inactivo`.

La operación masiva:

- elimina solo huérfanos;
- archiva registros con dependencias;
- reporta errores individualmente.

`restoreProveedor()` reactiva el mismo record ID.

## Datos importados

Antes de construir enlaces:

- email pasa por validación;
- teléfono/WhatsApp pasan por validación;
- web exige HTTPS válido y sin credenciales embebidas.

## CSV

La exportación:

- incluye supplierId;
- respeta búsqueda y categoría;
- neutraliza valores que comiencen con `=`, `+`, `-` o `@`;
- registra una acción de exportación mediante la auditoría de Oficina cuando está disponible.

## Paginación

Las recargas de Proveedores usan el helper paginado de Airtable y un límite superior de 2.000 en vez del antiguo corte de 500.

## Backend / RBAC

El proxy reconoce explícitamente:

- Proveedores;
- SupplierApplications;
- SupplierPrices;
- SupplierCategories;
- SupplierEvaluations;
- PurchaseOrders;
- PurchaseOrderItems;
- PurchaseOrderEvents.

Cada tabla tiene:

- métodos permitidos;
- allowlist de campos;
- validación de tipo;
- control de rol.

Campos o tablas no catalogados fallan cerrado.

## Tablas creadas en Airtable

En la base `app1YtD74AqiPWQhy` se crearon de forma no destructiva:

- `SupplierApplications`;
- `SupplierPrices`;
- `SupplierCategories`;
- `SupplierEvaluations`;
- `PurchaseOrders`;
- `PurchaseOrderItems`;
- `PurchaseOrderEvents`.

También se agregaron:

- `Proveedores.Supplier ID`;
- `Pedidos.Proveedores`.

No se borraron registros existentes.

## Criterios de aceptación

1. Renombrar un proveedor no rompe vínculos: supplierId/record links.
2. Un retry crea como máximo una postulación/proveedor: Durable Objects + dedup.
3. Dos equipos no reservan el mismo N° OC: secuencia backend.
4. Cambios concurrentes no pisan OC: expectedRevision + serialización; precios son filas independientes.
5. Campos de Proveedores pueden limpiarse intencionalmente.
6. Evaluación conserva actor, fecha, motivo y evidencia.
7. Ficha usa costos de OC, no revenue del cliente.
8. Proveedor con dependencias no se elimina destructivamente.
9. OC se aprueba, envía por correo real, recibe por ítem y factura/pago quedan trazables.
10. `tests/proveedores-wiring.test.js` no debe contener TODO de la auditoría.

## Pendiente externo

Código y esquema Airtable no significan que todos los Workers estén ya publicados.

Para producción final corresponde:

- desplegar `airtable-proxy` actualizado;
- desplegar `lead-worker` con el binding/migración de `SupplierApplicationGuard`;
- confirmar Cloudflare Access/RBAC;
- confirmar `PUBLIC_LEAD_KEY` y `TURNSTILE_SECRET`;
- smoke productivo de postulación, conversión, creación manual, OC concurrente y correo real.

Estos pasos deben agruparse con el cierre operativo final de infraestructura, no ejecutarse desde el navegador del usuario.
