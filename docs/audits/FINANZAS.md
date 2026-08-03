# Auditoría de FINANZAS

Fecha: 2026-08-02

## Alcance

Se revisó la sección `finanzas` y sus vínculos con:

- facturas históricas, ventas manuales y tabla `Facturas` de Airtable;
- pedidos, cotizaciones y clientes;
- DTE/SII y carga de CAF;
- cuentas por cobrar, aging y cobranza;
- Libro Diario, arqueo y flujo de caja;
- presupuesto mensual y punto de equilibrio;
- IVA mensual;
- préstamos y deuda;
- calculadoras de costos 3D, láser y neón;
- metas, comisiones y remuneraciones;
- Google Ads y revenue del CRM.

## Flujo verificado

1. El módulo carga la sección y sus subtabs internos.
2. `finGetAllFacturas()` combina histórico, ventas locales y `state.facturas`.
3. Facturas y cobranza usan una misma función de vencimiento.
4. El flujo de caja proyecta ocho semanas usando facturas y pagos programados.
5. Libro Diario alimenta presupuesto, IVA y arqueo.
6. `emitirDTE()` valida receptor y monto, llama al Worker y crea una fila en `Facturas`.
7. Las calculadoras transfieren costo y venta neta a una cotización.
8. Comisiones usan pedidos no cancelados y costo real cuando está disponible.
9. El correo de cobranza se registra después de una respuesta exitosa del servicio de correo.

## Cobertura automática

Archivo:

- `tests/finanzas-wiring.test.js`

Workflow:

- `.github/workflows/finanzas-audit.yml`

La prueba protege navegación, funciones únicas, fuentes de facturas, agregación interna, cobranza, aging, caja, Libro Diario, presupuesto, DTE, calculadoras y comisiones.

## Hallazgos pendientes

### 1. Revenue congelado y separado de Airtable

`finVentasMerged()` usa `FIN_VENTAS` y `fin_ventas`, pero no agrega las facturas de Airtable. Los KPIs y gráficos mantienen además rótulos como `Ene–May 2026`.

Consecuencia: un DTE nuevo puede aparecer en cobranza, pero no mover el revenue anual ni el Overview financiero.

### 2. Posibles facturas duplicadas

`finGetAllFacturas()` concatena tres fuentes sin deduplicación. Una factura histórica que también esté importada a Airtable puede contarse dos veces.

Corrección esperada: una llave estable basada en tipo DTE, folio y emisor, conservando el registro más completo.

### 3. Vencimiento y pagos incompletos

`finFacturasFromAirtable()` no conserva `Fecha Vencimiento` y considera completamente pendiente cualquier estado distinto de `Cobrada`.

Esto no representa anulaciones, notas de crédito ni pagos parciales. Además, `finVenc()` termina usando el primer día del mes más un plazo por defecto.

### 4. Aging mal rotulado

El tramo `Corriente` incluye facturas con hasta 30 días de mora. Debe separar no vencidas de 1–30 días vencidos.

### 5. Ventas manuales sin persistencia confiable

`nvGuardar()`, `nvEliminar()` y `nvLimpiarTodas()` modifican primero `localStorage` y llaman `saveFinVentasAirtable()` sin esperar resultado. No se encontró una definición operativa de esa función en el código actual.

Se requiere persistencia await, confirmación remota y rollback.

### 6. Datos financieros dependientes del navegador

Libro Diario, presupuesto, pagos programados, saldo inicial, arqueos, cobranza, sueldos y varios parámetros viven en `localStorage`.

No son una fuente compartida, auditable ni recuperable desde otro dispositivo.

### 7. IVA no apto como F29

`_ivaMes()` calcula débito desde pedidos creados durante el mes, aunque no exista DTE. El crédito se estima desde gastos genéricos del Libro Diario, sin exigir documento tributario.

Debe mostrarse únicamente como proyección interna hasta usar DTE emitidos, notas de crédito y compras documentadas. No debe presentarse como cálculo tributario oficial.

### 8. Emisión DTE sin idempotencia ni conciliación

El flujo puede emitir un DTE externo y luego fallar al guardar el pedido o la factura en Airtable. También permite emitir un nuevo DTE aunque ya exista uno, sin control transaccional.

Debe usar una referencia idempotente, validar el cuerpo de la respuesta y disponer de una cola de reconciliación.

### 9. CAF y Worker SII desde el navegador

El CAF XML se envía directamente desde el cliente a una URL configurada. No existe autenticación explícita en la llamada del módulo.

La operación debe pasar por un backend autenticado y con registro de auditoría.

### 10. Calculadora 3D multiplica extras incorrectamente

En `c3dCalcPieza()`:

- los extras `flat` se suman al costo unitario y luego se multiplican por la cantidad;
- los extras `unit` pueden multiplicarse por la cantidad dentro de `costoExtras` y nuevamente en `costoTotal`.

Los costos fijos deben repartirse una vez por trabajo y los unitarios una vez por unidad.

### 11. Utilidad de venta manual mezcla neto y bruto

`nvRecalcular()` usa `total con IVA - costo`. Si el costo está registrado neto, la utilidad queda inflada por el IVA.

Se debe definir la base del costo y calcular utilidad neta de forma consistente.

### 12. Mezcla de montos netos y brutos

El donut por canal y el ranking de clientes usan `pago` cuando existe y `valor × cantidad` cuando no. La primera fuente suele ser bruta y la segunda neta.

Todos los reportes deben declarar y mantener una sola base monetaria.

### 13. Exportación de presupuesto distinta de la pantalla

La pantalla usa el ejecutado real del Libro Diario cuando el ajuste manual está vacío. `presExportCSV()` exporta solamente `c.ejecutado`, por lo que puede informar cero mientras la pantalla muestra gasto real.

### 14. Préstamos sin orden temporal confiable

`FIN_PRESTAMOS` es una matriz fija y contiene `13/03/25` dentro de una secuencia 2026. El gráfico usa el orden del arreglo, no una fecha parseada.

### 15. WhatsApp registra una gestión no confirmada

`cobWhatsApp()` abre WhatsApp y registra inmediatamente el toque, aunque el mensaje no se haya enviado. Esto puede adelantar erróneamente la secuencia de cobranza.

### 16. Punto de equilibrio usa pedidos creados

La venta del mes se obtiene desde pedidos creados, no desde facturación o revenue reconocido. Debe etiquetarse como venta contratada o usar una fuente contable definida.

## Criterio de cierre

- Revenue, facturas y cobranza comparten una fuente de verdad sin duplicados.
- Vencimientos, anulaciones, notas de crédito y pagos parciales se representan correctamente.
- Datos financieros compartidos y auditables fuera de `localStorage`.
- IVA claramente proyectado y basado en documentos tributarios.
- DTE y CAF autenticados, idempotentes y reconciliables.
- Calculadoras sin doble multiplicación y con base neta/bruta explícita.
- Exportaciones coinciden con los valores mostrados.
- Los `test.todo` pasan a controles activos.
- Workflow `Finanzas audit` en verde.
