# Finanzas ↔ Google Sheets: Ingresos y Egresos (noviembre 2026)

## Qué se integra

Archivo original: https://docs.google.com/spreadsheets/d/12OYYXY8ExcAvhwB_A4PTPkghowA5Cm_8BSgJ_gZAuqo/edit

Pestaña existente: `NOVIEMBRE 2026`.

- Fila 3: encabezados C=FECHA, D=INGRESOS, E=EGRESOS, F=DETALLE.
- Filas 4–33: días 1–30 de noviembre de 2026.
- I3: saldo inicial. I10/I11/I13 contienen fórmulas de totales; **no se escriben**.
- El nuevo panel aparece al final de **Finanzas → Libro Diario** y se llama **Ingresos y Egresos · Google Sheets**. No reemplaza ni sincroniza automáticamente los datos del Libro Diario del dashboard, facturas, IVA o presupuestos. Permite trabajar sobre las mismas celdas del Google Sheet desde el dashboard.

## Cómo activarlo

1. En Google Cloud Console, proyecto asociado al **Google OAuth Client ID** que ya usa el dashboard, confirmar que **Google Sheets API** está habilitada. El dashboard ya usa Google Identity Services y solicita el scope de Drive.
2. Ingresar al dashboard con una cuenta autorizada para ver Finanzas y usar **thelabsolutionscl@gmail.com** (o una cuenta con acceso de Editor a la planilla) en la conexión Google Drive del dashboard.
3. Abrir **Finanzas → Libro Diario → Ingresos y Egresos · Google Sheets** y seleccionar **Conectar / actualizar**.
4. Si el navegador pide autorizar Google Drive, aprobarlo para la cuenta correcta.
5. Editar ingreso, egreso o detalle de un día y seleccionar **Guardar**. La operación confirma por lectura que quedó escrita.
6. Cambios introducidos directamente en Google Sheets se leen al abrir/actualizar el panel y automáticamente aproximadamente cada 30 segundos mientras está visible y hay sesión OAuth vigente.

## Precauciones de integridad

- **No se cambia la planilla original** en este PR ni se toca su formato o sus fórmulas. No se crean pestañas.
- La fuente es la hoja Google original; no se mantiene una segunda copia en Airtable/localStorage.
- Antes de guardar se comprueba que el número del día y la fila remota no cambiaron desde la última lectura. Ante discrepancia se rechaza la escritura.
- La comprobación previa no es una transacción atómica: dos escrituras perfectamente simultáneas pueden colisionar entre la lectura y el PUT. No editar la misma fila en ambos lugares exactamente al mismo tiempo. Para garantía fuerte se requiere puente server-side con versiones y control de concurrencia.
- **No es sincronización permanente 24/7**: con el dashboard cerrado no hay una copia que actualizar; la planilla mantiene todos los datos y el dashboard los lee cuando se abre y autoriza. La sesión de Google puede necesitar reconexión después de expirar.
- El formato presente agrega como máximo un ingreso y un egreso por día en cada fila. Movimientos múltiples del mismo día requieren una tabla de transacciones nueva y una migración de datos explícita.
- Solo se integra **noviembre de 2026**. Nuevas pestañas mensuales requerirán validación del formato y ampliación de selector.
- No confundir con ingresos contables netos/facturación/IVA. Esta hoja es un registro de caja independiente.

## Verificación manual antes de fusionar

1. Abrir con el usuario administrador del dashboard y conexión Drive de la cuenta autorizada.
2. Confirmar que la API carga I3 y filas C4:F33 y que los totales cuadran.
3. Editar en el dashboard un día de prueba y verificar el cambio en las columnas D:F de la hoja, conservando I10/I11/I13.
4. Editar la misma fila desde Google Sheets y comprobar que el dashboard la relee luego de 30 segundos o al pulsar actualizar.
5. Abrir dos pestañas, modificar la misma fila directamente en Google Sheets y comprobar que Guardar en el dashboard detecta el conflicto.
6. Comprobar que el Libro Diario compartido, las facturas y los saldos de IVA no cambiaron.
7. Verificar error legible al entrar con Google sin permiso de edición o con Sheets API deshabilitada.
