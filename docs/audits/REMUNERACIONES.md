# Auditoría de REMUNERACIONES

## Alcance

La pestaña `remuneraciones` está implementada dentro de `index.html`. El módulo actualmente combina:

- comisiones comerciales sobre pedidos despachados/completados;
- pipeline potencial desde cotizaciones solicitadas/enviadas;
- pedidos en proceso;
- una interfaz de sueldo base y “liquidación”.

No es todavía un sistema de nómina o liquidación legal. La parte funcional comprobable es el cálculo comercial de comisiones.

## Hallazgos críticos

### 1. La sección de liquidación está rota

`renderRemuneraciones()` invoca `remRenderLiquidacion(totalNeto,totalComision)`, pero no existe una definición de `remRenderLiquidacion` en `index.html` ni en los módulos JavaScript cargados.

La interfaz también llama a `remToggleSueldos()` y `remSaveSueldos()`, sin definiciones encontradas. En consecuencia, abrir la pestaña puede lanzar un `ReferenceError` antes de completar las tablas, y los controles de sueldo base no son operativos.

### 2. “Comisión ganada” no tiene estado financiero autoritativo

La comisión se considera ganada cuando un pedido está `Despachado` o `Completado`. No se verifica:

- factura emitida o válida;
- pago recibido y conciliado;
- pago parcial;
- nota de crédito, devolución o anulación;
- aprobación de la comisión;
- fecha real de devengo o pago.

El resultado es una estimación comercial, no una obligación de pago cerrada.

### 3. Tasa y base de cálculo rígidas

La tasa `0.035` está repetida directamente en render y exportación. No hay vigencia, contrato, vendedor, producto, tramo, meta ni excepción.

El neto se calcula siempre como `bruto / 1.19`. Esto supone que todo el monto está afecto al IVA chileno de 19 % y que el total no contiene conceptos exentos, descuentos, propinas, retenciones, monedas distintas o ajustes tributarios.

### 4. Pipeline potencial sobreestimado

El pipeline incluye todas las cotizaciones `Solicitada` o `Enviada`, aunque estén vencidas. La fecha vencida solo se colorea; no se excluye ni se reduce su probabilidad.

Tampoco hay probabilidad por etapa, fecha esperada de cierre, confianza, duplicados, moneda ni regla de expiración. El KPI debe rotularse como estimación bruta o incorporar un modelo de pipeline ponderado.

### 5. Seguridad y privacidad dependen del navegador

`vendorOwnsRecord()` filtra pedidos y cotizaciones en cliente. Ese filtro mejora la vista, pero no sustituye autorización en el origen de datos.

Además, `demo` incluye la pestaña en RBAC y `vendorOwnsRecord()` devuelve `true` para cualquier rol no comercial. Si un usuario demo recibe datos reales, podría visualizar comisiones de todos los vendedores. La API/proxy debe limitar filas y campos antes de entregarlos al navegador.

### 6. No hay cierre, aprobación ni trazabilidad

No existe entidad de período de comisiones con estados como borrador, revisado, aprobado, pagado o reabierto. Tampoco hay historial de ajustes, responsable, motivo, evidencia de pago ni bloqueo de meses cerrados.

Recalcular desde pedidos vivos permite que una edición histórica cambie retroactivamente la cifra mostrada.

## Hallazgos importantes

### Períodos y fechas

- El filtro usa `Fecha entrega`, no una fecha de devengo/cobro de comisión.
- “Esta semana” comienza el domingo por `Date#getDay()`.
- Las comparaciones dependen de la zona horaria del navegador, no de una política explícita `America/Santiago`.
- El período predeterminado es `todo`, lo que mezcla años y puede mostrar una suma histórica como si fuera saldo actual.

### Exportación CSV

`exportRemCSV()` concatena valores con comas sin escape RFC 4180. Un cliente con coma, comillas o salto de línea puede romper columnas. Faltan BOM UTF-8, período, vendedor, fecha de generación, tasa aplicada y una protección contra fórmulas de spreadsheet.

### Semántica de interfaz

La pantalla mezcla conceptos distintos:

- sueldo base;
- comisión estimada de pipeline;
- comisión calculada por despacho;
- remuneración o liquidación.

Deben mostrarse estados separados: estimada, devengada, aprobada, pagada y revertida. Hasta existir un motor de nómina, no conviene llamar “liquidación” a un cálculo local incompleto.

## Recomendación de modelo

Crear entidades autoritativas:

1. `CommissionRules`: vendedor, tasa, base, vigencia, condiciones y versión.
2. `CommissionEvents`: pedido/factura/pago, monto elegible, estado y reversa.
3. `CommissionPeriods`: período, vendedor, borrador, aprobación, cierre y pago.
4. `CommissionAdjustments`: monto, motivo, responsable y evidencia.
5. `Payroll`: solo si se implementará nómina real, separada del módulo comercial.

La comisión debe derivarse de eventos financieros idempotentes y quedar congelada al cerrar el período. Los cambios posteriores deben generar ajustes, no reescribir silenciosamente la historia.

## Cobertura agregada

- `tests/remuneraciones-wiring.test.js`
- `.github/workflows/remuneraciones-audit.yml`

Las pruebas activas protegen el cableado existente. Los defectos confirmados permanecen como `test.todo` hasta que exista una implementación verificable.

## Criterios de aceptación

1. La pestaña abre sin errores y todos sus botones tienen funciones definidas.
2. La tasa y base de comisión provienen de una regla versionada.
3. Una comisión distingue estimada, devengada, aprobada, pagada y revertida.
4. Notas de crédito, anulaciones, devoluciones y pagos parciales ajustan el cálculo.
5. Los períodos cerrados son inmutables y auditables.
6. El backend entrega a cada vendedor únicamente sus registros autorizados.
7. El rol demo nunca recibe remuneraciones reales.
8. Pipeline vencido no se presenta como potencial pleno.
9. Fechas y semanas siguen una política explícita de Chile.
10. CSV es seguro, trazable y compatible con datos que contienen comas/comillas.
11. “Liquidación” se usa solo para un cálculo de nómina completo y validado.
12. Los `TODO` del test se convierten gradualmente en pruebas obligatorias.
