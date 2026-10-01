# Auditoría de PROVEEDORES

Fecha: 2026-08-02

## Alcance

Se revisaron:

- `index.html`: navegación, formularios, filtros, modales y RBAC.
- `js/proveedores.js`: maestro, categorías, reputación, postulaciones, precios, exportación y órdenes de compra.
- `lead-worker/src/index.js`: formulario público `POST /proveedor` y notificación interna.
- La integración con `Pedidos`, inventario, Monitor Sistema, Airtable y documentos imprimibles.
- El historial de cambios asociado a postulaciones, precios y órdenes de compra.

## Flujo observado

1. El dashboard carga hasta 500 registros de `Proveedores` desde Airtable.
2. Admin/gerencia pueden buscar, filtrar, crear, editar, evaluar, bloquear y eliminar proveedores.
3. El formulario público `/proveedor` crea postulaciones con estado `ENTREVISTAR` y envía una notificación interna.
4. Cada ficha calcula pedidos activos e historial usando el nombre textual del proveedor.
5. La reputación es una puntuación manual de una a cinco estrellas.
6. El historial de precios se guarda como un arreglo JSON en `localStorage` y se respalda completo en `Monitor Sistema / PRECIOS_PROV`.
7. Las órdenes de compra se numeran y guardan de la misma forma en `localStorage`, con respaldo en `ORDENES_COMPRA`.
8. Los precios pueden autocompletar una OC y alimentar sugerencias de reorden de inventario.

## Fortalezas comprobadas

- Validación de email, teléfono y RUT en creación y edición desde el dashboard.
- Categorías múltiples, filtros, ordenamiento y una ficha expandible con contacto y pedidos.
- Actualización optimista con rollback para reputación y estado de postulación.
- Formulario público con clave compartida opcional, honeypot, Turnstile opcional y rate limit.
- Estado inicial `ENTREVISTAR` para postulaciones públicas.
- Historial de precios por ítem, normalización de nombres, tendencia y comparación entre proveedores.
- Generación de órdenes de compra con ítems, neto, IVA, total y documento imprimible.
- Exportación CSV con escape de comas/comillas y BOM UTF-8.
- Integración con inventario y reorden inteligente.

## Hallazgos críticos

### 1. La identidad del proveedor depende del nombre

Pedidos, precios y órdenes de compra enlazan al proveedor mediante texto. La ficha compara:

`pedido.fields['Proveedor'].toLowerCase() === nombre.toLowerCase()`

Las OC guardan `proveedor: <nombre>` y el historial de precios usa el mismo criterio.

Consecuencias:

- renombrar un proveedor rompe sus vínculos históricos;
- dos proveedores con el mismo nombre quedan mezclados;
- espacios, tildes o cambios de mayúsculas crean identidades distintas;
- los pedidos con varios proveedores en una cadena separada por comas no coinciden con la igualdad exacta;
- no existe integridad referencial.

**Corrección:** utilizar `supplierId`/record ID de Airtable en pedidos, precios, OC, facturas e inventario. El nombre debe ser solo una etiqueta visible.

### 2. La creación puede duplicar proveedores

`createProveedor()` ejecuta un POST completo y, ante cualquier error, intenta otro POST con campos mínimos.

Si el primer POST alcanzó Airtable pero la respuesta se perdió por timeout, red o proxy, el segundo intento crea otra fila. Tampoco existe una idempotency key ni upsert por RUT/email.

El formulario público también crea una fila nueva en cada envío válido, sin deduplicación.

**Corrección:** reservar una idempotency key y resolver por RUT normalizado, email o identidad empresarial antes de crear. El fallback de esquema debe aplicarse únicamente tras confirmar que Airtable rechazó la primera operación sin crear registro.

### 3. Numeración de OC no es atómica

`_ocNextNum()` inspecciona las OC disponibles en el navegador y calcula `máximo + 1`. Dos equipos pueden generar simultáneamente `OC-AAAA-NNN` con el mismo número.

Además, las órdenes viven en un arreglo local y el respaldo remoto reemplaza el JSON completo.

**Corrección:** reservar correlativos y crear cada OC mediante backend/transacción. El número debe tener restricción única.

### 4. Precios y OC usan sincronización last-write-wins

`PRECIOS_PROV` y `ORDENES_COMPRA` son blobs JSON completos. Dos usuarios que trabajen en paralelo pueden sobrescribir cambios mutuamente. No existen revisiones, control de concurrencia, autor, timestamps confiables ni eventos de auditoría.

**Corrección:** crear tablas/entidades individuales para `SupplierPrices`, `PurchaseOrders`, `PurchaseOrderItems` y sus eventos.

## Hallazgos altos

### 5. Editar no permite limpiar campos

Antes del PATCH se eliminan del payload todos los campos vacíos. Si se borra teléfono, web, notas, condiciones de pago, productos o comuna, Airtable nunca recibe el valor vacío y conserva el dato anterior.

Debe distinguirse entre “campo no incluido” y “campo que el usuario decidió limpiar”.

### 6. El valor atribuido al proveedor es ingreso comercial

La ficha muestra `Total pedidos` sumando `Monto total (CLP)` de los pedidos de clientes. Ese monto es la venta, no el gasto pagado o comprometido con el proveedor.

Esto puede confundir facturación al cliente con costo de compra. Deben separarse:

- gasto de OC;
- recepción;
- factura del proveedor;
- pago;
- costo real por pedido;
- ahorro versus alternativa.

### 7. Evaluación sin evidencia ni historial

Cualquier usuario habilitado puede cambiar directamente `ENTREVISTAR`, `APROBADO` o `RECHAZADO`. El motivo no es obligatorio y se guarda separadamente.

No se registran:

- responsable;
- fecha y hora;
- checklist de documentos;
- capacidad o certificaciones;
- evaluación técnica/comercial;
- conflicto de interés;
- historial de cambios;
- aprobación por segunda persona.

La reputación es un entero mutable sin relación con entregas reales.

### 8. Eliminación destructiva sin dependencias

Un proveedor puede eliminarse aunque tenga pedidos, precios, OC o postulaciones. La restauración recrea una fila nueva y, por tanto, otro record ID. La eliminación masiva no ofrece undo.

Debe preferirse `Archivado/Inactivo/Bloqueado` y prohibir eliminación cuando existan dependencias.

### 9. Categorías locales y divergentes

El catálogo, su orden y colores viven en `localStorage`. Cada navegador puede mostrar categorías distintas. Eliminar una categoría local no migra los registros Airtable que todavía la usan.

Las categorías deben ser configuración compartida con identificador estable y operación explícita de renombrar/migrar.

### 10. Órdenes de compra sin ciclo operativo

Una OC nace directamente como `Emitida`, aunque solo se haya guardado localmente. No distingue:

- borrador;
- solicitada para aprobación;
- aprobada;
- enviada;
- aceptada/rechazada por proveedor;
- recibida parcial/total;
- facturada;
- pagada/cerrada;
- cancelada.

Tampoco registra destinatario, fecha de envío, aceptación, recepción, adjuntos o conciliación financiera.

## Hallazgos medios

- Todas las OC aplican IVA 19 % sin permitir ítems exentos, otro impuesto o moneda.
- Los precios se describen “sin IVA”, pero no guardan moneda, origen, validez, cantidad mínima ni documento de cotización estructurado.
- El identificador local de precio se construye a partir del largo del arreglo, largo del nombre y precio; puede repetirse después de eliminaciones o entre dispositivos.
- El autocompletado de precios por inclusión textual puede elegir un ítem parecido pero incorrecto.
- El sitio web, teléfono, email y WhatsApp se validan principalmente al editar manualmente; registros importados pueden contener valores no normalizados.
- La exportación CSV ignora filtros activos, no neutraliza fórmulas y no registra quién exportó datos de contacto.
- La recarga usa un límite de 500 registros sin paginación completa.
- El RBAC del navegador oculta o bloquea acciones, pero la autorización final debe imponerse en backend/proxy por tabla, fila y campo.
- El formulario público tiene clave y Turnstile opcionales; una configuración incompleta reduce la defensa a honeypot y rate limit.
- La notificación por email es best-effort; no existe bandeja de errores o reconciliación entre aviso y fila Airtable.

## Modelo recomendado

### Supplier

- `supplierId` estable.
- Razón social, nombre comercial, RUT normalizado y estado.
- Contactos separados y cuentas autorizadas.
- Categorías mediante relación a `SupplierCategories`.
- Datos bancarios cifrados y acceso restringido, si se incorporan.

### SupplierApplication

- Identidad/idempotency key.
- Fuente, payload normalizado y fecha.
- Estado con eventos y responsable.
- Checklist, documentos y decisión motivada.
- Conversión explícita a Supplier sin duplicar.

### SupplierEvaluation

- Pedido/recepción relacionada.
- Calidad, puntualidad, precio, respuesta e incidentes.
- Evaluador, fecha, comentario y evidencia.
- Score agregado derivado, no editable directamente.

### SupplierPrice

- `supplierId`, SKU/materialId y descripción.
- Moneda, unidad, precio neto, impuesto y cantidad mínima.
- Vigencia desde/hasta.
- Documento fuente y autor.
- Historial inmutable.

### PurchaseOrder

- Correlativo reservado en servidor.
- `supplierId`, moneda y condiciones.
- Estados y aprobaciones.
- Ítems individuales.
- Envío, aceptación, recepción y conciliación con factura/pago.
- Eventos de auditoría e idempotencia.

## Prioridad de corrección

1. Migrar relaciones textuales a `supplierId`.
2. Evitar duplicados en creación dashboard y pública.
3. Llevar OC y precios a registros individuales backend.
4. Correlativo atómico y estados reales de OC.
5. Permitir limpiar campos y proteger eliminaciones.
6. Separar gasto del proveedor de ingreso del pedido.
7. Versionar evaluación, categorías y permisos.
8. Completar paginación, exportación segura y validación de enlaces.

## Cobertura agregada

- `tests/proveedores-wiring.test.js`
- `.github/workflows/proveedores-audit.yml`

Las pruebas activas protegen el cableado actual. Los defectos comprobados permanecen como `test.todo` hasta que exista una implementación verificable.

## Criterios de aceptación

1. Renombrar un proveedor no rompe pedidos, precios, OC ni reportes.
2. Un reintento crea como máximo una postulación/proveedor.
3. RUT/email duplicados se detectan y se resuelven explícitamente.
4. Dos equipos no pueden reservar el mismo número de OC.
5. Cambios concurrentes no sobrescriben precios u órdenes.
6. Un usuario puede limpiar campos voluntariamente.
7. La ficha muestra gasto real del proveedor, no revenue del cliente.
8. Aprobar/rechazar conserva responsable, motivo, fecha y evidencia.
9. Un proveedor con dependencias no puede eliminarse destructivamente.
10. Las OC recorren un ciclo aprobado, enviado, recibido y conciliado.
11. Catálogos y permisos son compartidos y autoritativos.
12. Los `TODO` del test se convierten gradualmente en pruebas obligatorias.
