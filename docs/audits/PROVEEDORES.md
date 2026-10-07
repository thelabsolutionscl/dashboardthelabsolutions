# Auditoría de PROVEEDORES

## Estado

Auditoría funcional #108 cerrada en código.

El maestro de proveedores conserva la interfaz existente, pero la fuente de verdad operativa pasa a SupplierOps en el proxy autenticado. El record ID de Airtable de `Proveedores` es el `supplierId` canónico.

## Identidad y relaciones

- El nombre queda como etiqueta visible.
- Precios, evaluaciones y órdenes guardan `supplierId`.
- El bootstrap crea relaciones Airtable `multipleRecordLinks` hacia `Proveedores` en:
  - SupplierPrices
  - PurchaseOrders
  - SupplierEvaluations
  - Pedidos
  - Facturas
  - Inventario
- El snapshot migra pedidos históricos por nombre solo cuando el match es inequívoco. Un nombre ambiguo no se migra automáticamente.
- Renombrar el proveedor ya no rompe precios, OC ni evaluaciones.

## Tablas autoritativas

El bootstrap de SupplierOps asegura:

- `SupplierPrices`
- `PurchaseOrders`
- `PurchaseOrderItems`
- `SupplierEvaluations`
- `SupplierCategories`

Son registros individuales, no blobs JSON de navegador.

## Creación y deduplicación

### Dashboard

`createSupplier` pasa por un Durable Object serializado con `mutationId`.

Antes de crear se busca duplicado por:

- RUT normalizado;
- email normalizado;
- nombre/razón social normalizado.

Repetir el mismo `mutationId` devuelve el resultado previo.

### Formulario público

`POST /proveedor` mantiene:

- clave pública opcional;
- honeypot;
- Turnstile;
- rate limit.

Además incorpora:

- `Idempotency-Key` o hash determinista de identidad;
- cache de idempotencia en KV cuando está disponible;
- deduplicación Airtable antes de crear;
- validación de email, teléfono y URL;
- creación de una sola vez: network/5xx ambiguos no disparan otro POST;
- `securityWarnings` si faltan Turnstile o KV/RL.

## Evaluación

Cambiar a ENTREVISTAR/APROBADO/RECHAZADO crea un `SupplierEvaluation`.

APROBADO/RECHAZADO exige:

- motivo;
- checklist;
- evidencia/referencia.

Cada evento conserva:

- responsable;
- fecha;
- estado;
- evidencia;
- checklist;
- dimensiones de score.

La reputación visible se deriva de calidad, puntualidad, precio, respuesta e incidentes. Ya no se edita directamente como estrella mutable.

## Historial de precios

Cada precio incluye:

- supplierId y relación real;
- item key;
- ítem/SKU;
- moneda;
- unidad;
- precio neto;
- tasa de impuesto;
- compra mínima;
- vigencia;
- documento/URL fuente;
- revisión;
- autor y timestamp.

Al registrar un nuevo precio equivalente, el anterior se cierra y queda histórico.

## Órdenes de compra

Las OC viven en `PurchaseOrders` y sus líneas en `PurchaseOrderItems`.

El correlativo `OC-AAAA-NNN` se reserva dentro del mismo Durable Object que serializa las mutaciones. Dos equipos no calculan `max + 1` en el navegador.

Estados soportados:

`Borrador → Aprobación → Aprobada → Enviada → Aceptada → Recibida parcial/total → Facturada → Pagada → Cerrada`

y `Cancelada` desde los estados permitidos.

Se registra actor/fecha en aprobación, envío, aceptación, recepción, facturación, pago, cierre o cancelación.

La recepción se controla por ítem con `Cantidad recibida`.

## Categorías

`SupplierCategories` centraliza nombre, color, orden, estado y revisión.

- agregar/reordenar sincroniza configuración;
- borrar una categoría en uso se bloquea;
- renombrar ejecuta una migración de los registros de proveedores antes de cambiar el catálogo.

## Eliminación

La UI ya no elimina físicamente proveedores.

`archiveSupplier` consulta dependencias y conserva siempre el mismo record ID:

- con dependencias → Archivado;
- sin dependencias → Inactivo.

No existe restauración que cree una identidad nueva.

## Métricas

La ficha ya no suma `Monto total (CLP)` de ventas a clientes.

Muestra **Gasto OC comprometido**, calculado desde PurchaseOrders no canceladas del proveedor.

## Exportación

El CSV de proveedores:

- respeta búsqueda y filtro de categoría activos;
- conserva BOM UTF-8 y escape RFC4180;
- neutraliza valores que comienzan con `=`, `+`, `-` o `@`;
- registra un evento `export` en la auditoría del proxy.

## Seguridad

Cloudflare Access aplica:

- snapshot: viewer/sales/operator/finance/admin;
- mutaciones: operator/finance/admin;
- bootstrap: admin.

Las mutaciones se serializan en `CRM_MUTATION_GUARD` con la instancia `tls-supplier-ops`.

Bootstrap y mutaciones exitosas dejan eventos de auditoría.

## Cobertura

`tests/proveedores-wiring.test.js` ya no contiene `test.todo`.

El workflow Proveedores valida:

- frontend;
- lead-worker;
- proxy;
- RBAC;
- smoke general.

## Pendiente externo agrupado en #306

Para producción aún corresponde:

1. desplegar el proxy/Worker actualizado;
2. ejecutar una vez `POST /suppliers/bootstrap` como admin para crear/actualizar el esquema;
3. confirmar que el token Airtable tenga permiso de metadata/schema write para ese bootstrap;
4. desplegar lead-worker actualizado;
5. confirmar bindings de Turnstile y KV/RL;
6. verificar migración real de relaciones históricas y revisar manualmente casos ambiguos;
7. probar concurrencia real de dos equipos creando OC.

No se requiere volver a los blobs `PRECIOS_PROV` ni `ORDENES_COMPRA`; quedan como legado de migración, no como fuente autoritativa.
