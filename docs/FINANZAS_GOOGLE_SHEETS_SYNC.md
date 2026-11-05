# Libro Diario ↔ Google Sheets — movimientos individuales

## Hoja de origen y respaldo

- Archivo original: https://docs.google.com/spreadsheets/d/12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo/edit (título actual: Libro Diario).
- Respaldo realizado antes de migrar: https://docs.google.com/spreadsheets/d/1O6lPIA3YvPCIN1Z_fcLn-BohWX8zbvk-8BtEgdsayOg/edit.
- La pestaña original `NOVIEMBRE 2026` conserva los 30 días y el saldo inicial de **$45.140**.
- Nueva pestaña `MOVIMIENTOS`, una fila por movimiento. Encabezados exactos en A1:K1:
  `ID | FECHA | TIPO | CATEGORÍA | DESCRIPCIÓN | MONTO | MÉTODO | REFERENCIA | PROVEEDOR/CLIENTE | ESTADO | ACTUALIZADO`.
- Las entradas históricas migradas son:
  - `tls-legacy-2026-11-02-ingreso`: 2026-11-02, ingreso $15.500, DEV GUSTAVO.
  - `tls-legacy-2026-11-03-gasto`: 2026-11-03, gasto $10.380, COMIDA KAISER.
- Los movimientos se muestran en la tabla original de Finanzas → Libro Diario, sin duplicar registros en `FINANZAS_V2`/Airtable.

## Uso del dashboard

1. Entrar a Finanzas → Libro Diario y pulsar **Conectar / actualizar Google Sheets**.
2. En **Guardar movimiento en**, elegir **Google Sheets · movimientos individuales**.
3. Registrar tantos ingresos y egresos como se necesiten en una misma fecha, cada uno con categoría, descripción, monto, método, referencia y contraparte. Cada alta recibe un ID único.
4. Usar **Editar** para modificar una sola transacción; la acción ✕ marca la fila como **Eliminado** sin borrarla físicamente.
5. Ediciones directas de MOVIMIENTOS se reflejan al pulsar actualizar o en el refresco de 30 segundos con el panel visible y OAuth activo.

## Resumen mensual NOVIEMBRE 2026

Las columnas D4:E33 deben depender de `SUMIFS` sobre MOVIMIENTOS filtrando fecha, tipo y `ESTADO=Activo`. La columna F4:F33 concatena detalles `TEXTJOIN/FILTER` por fecha. Las fórmulas de totales I10, I11 e I13 se conservan **sin cambios**. Se comprobó con la configuración regional `es_ES` que el separador correcto en fórmulas es **punto y coma (`;`)**.

El resumen mensual no se debe editar directamente: nuevos movimientos y modificaciones se hacen en `MOVIMIENTOS` o desde el dashboard.

## Protección contra errores

- Antes de editar/borrar, el cliente lee la fila y verifica que no haya cambios desde la última sincronización; luego verifica el resultado en Drive.
- Las bajas son reversibles (estado `Eliminado`); no se alteran los movimientos de otros días.
- Los registros del Libro Diario interno continúan en su almacenamiento de siempre, y no se exportan a MOVIMIENTOS salvo que el usuario seleccione Google Sheets en el formulario.
- Los totales, búsquedas y exportación CSV del Libro Diario reflejan ambas fuentes, pero arqueo, IVA, presupuestos y facturación no se modifican.
- Al vencerse la sesión de Drive, el usuario debe reconectar; no existe una sincronización desatendida de servidor.
- La API de Google Sheets no ofrece CAS transaccional por fila: dos escrituras exactamente simultáneas aún pueden competir en el intervalo entre verificación y PUT.
- Si Google devuelve un error después de enviar un alta, verificar MOVIMIENTOS antes de reintentar para no duplicar.

## Validación

- `node --test tests/finanzas-sheet-sync.test.js`
- `node --test tests/finanzas-wiring.test.js`
- `node --test tests/access-finance-shared-route.test.js`
- Comprobar lectura y edición con la cuenta de Google autorizada desde el navegador, y un movimiento de prueba que pueda eliminarse después.
