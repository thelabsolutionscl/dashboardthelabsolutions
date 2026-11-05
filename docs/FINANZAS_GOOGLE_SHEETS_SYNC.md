# Integración unificada — Finanzas → Libro Diario ↔ Google Sheets

## Archivo vinculado

- Hoja original: https://docs.google.com/spreadsheets/d/12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo/edit
- Pestaña: **NOVIEMBRE 2026**, fechas C4:C33, ingresos D4:D33, egresos E4:E33, detalle F4:F33.
- Saldo inicial I3 (solo lectura). Fórmulas I10, I11, I13 se preservan.

## Experiencia unificada

Ya no hay una segunda tabla o panel al final de Finanzas. Se integra directamente en la **tabla y formulario existentes de Libro Diario**:

1. Barra **Conectar / actualizar Google Sheets** junto a la tabla original.
2. Tras autorizar Google Drive, las filas de Google Sheets aparecen como ingresos y gastos en **la misma tabla del Libro Diario**, con categoría **Caja · Google Sheets** y método **Google Sheets**.
3. Los filtros, búsqueda, orden, paginación, CSV y los KPIs del **Libro Diario** tienen en cuenta las dos fuentes. No se copian registros de Google Sheets al documento financiero nativo.
4. En **Nuevo registro → Guardar movimiento en**, elegir:
   - **Libro Diario · registro completo**: guarda en el sistema financiero compartido, con categoría, método, referencia y contraparte.
   - **Google Sheets · caja noviembre 2026**: escribe únicamente fecha, ingreso/egreso, monto y detalle en la hoja original (D:F).
5. Los movimientos ya existentes de Google Sheets se pueden **Editar** desde el mismo formulario y **Eliminar** desde su fila.
6. Ediciones directas en Drive aparecen al pulsar **Conectar / actualizar**, al volver al panel, o durante la actualización periódica de 30 s mientras está visible y sigue vigente la autorización.

## Límites y protecciones

- Una fila por día, con una cifra agregada de ingresos y una de egresos y **un detalle compartido** entre ambas. Se rechaza crear otro ingreso/gasto del mismo tipo y día y cambiar un detalle compartido que ya pertenezca también a la otra columna.
- Esta fase cubre **noviembre de 2026**. El formulario exige día válido en ese mes si se selecciona Google Sheets.
- Antes de escribir se comprueba que la fila no cambió desde la última lectura; después se lee de nuevo para verificar el resultado. Dos cambios simultáneos dentro de la ventana entre lectura y escritura no tienen garantía transaccional completa.
- Los campos completos de **categoría, método, referencia y contraparte** no existen en la hoja y, por tanto, **no se transfieren** en registros de destino Google Sheets. Se explica en el selector del formulario.
- La tabla y los KPIs del Libro Diario incluyen ambas fuentes, pero **arqueo, IVA, presupuestos, facturación y otros módulos contables conservan las fuentes existentes**; no se altera su semántica ni se importa automáticamente el Sheet a esos cálculos.
- No se crean duplicados en `FINANZAS_V2` ni en Airtable. Los registros nativos ya existentes no se vuelcan a Google Sheets sin elegir ese destino.
- No requiere crear claves nuevas: se reutiliza el consentimiento OAuth del módulo Google Drive; hay que entrar con una cuenta que pueda editar esta planilla.
- El refresco automático requiere el panel visible y una sesión OAuth activa. No hay proceso continuo en el servidor con el dashboard cerrado.
- En caso de error o expiración OAuth, se conserva el documento original y se solicita reconexión. Se cancelan ediciones activas solo con confirmación del usuario.

## Pruebas antes de publicar

- `node --test tests/finanzas-sheet-sync.test.js`
- `node --test tests/finanzas-wiring.test.js`
- `node --test tests/access-finance-shared-route.test.js`
- Verificar que la tabla unificada se lee con el panel activo y Google Drive autorizado.
- Agregar un ingreso de prueba a un día vacío, comprobar el cambio en D y que I10/I11/I13 sigan siendo fórmulas.
- Editar y borrar esa entrada desde el Libro Diario; comprobar la planilla.
- Modificar directamente la hoja y verificar el refresco del Libro Diario.
- Confirmar que la contabilidad existente y las facturas no fueron modificadas.
