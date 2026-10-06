# Auditoría de EQUIPO

Fecha: 2026-08-02

## Flujo validado

Disponibilidad por persona → respaldo compartido → cruce con pedidos activos → detección de conflictos de entrega → sincronización opcional con Google Calendar → ranking, metas y comisiones.

## Relaciones protegidas

- `PERSONAS` es el padrón usado para calendario y configuración.
- `equipoState.eventos` conserva disponibilidad, reuniones, remoto, ausencias y vacaciones.
- `state.pedidos` aporta carga activa y fechas de entrega.
- Los pedidos `Despachado`, `Completado` y `Cancelado` quedan fuera de la carga activa.
- `renderComisiones` parte de pedidos no cancelados y recupera vendedor o margen desde la cotización vinculada cuando corresponde.
- La venta para comisión se normaliza a neto sin IVA.
- Las credenciales de Google Calendar se conservan en `sessionStorage`, no en `localStorage`.

## Hallazgos abiertos

### 1. Rango invertido

`saveEquipoEvento` exige ambas fechas, pero no rechaza una fecha final anterior a la inicial. Actualmente puede cerrar el modal y mostrar una confirmación aunque no se haya escrito ningún día.

**Criterio de cierre:** validar `end >= start`, mantener el modal abierto y mostrar un mensaje claro.

### 2. Falta de rollback

`saveEquipoEvento`, `deleteEquipoEvento` y `quickToggleEquipo` modifican `equipoState.eventos` y renderizan antes de confirmar el respaldo. Si Airtable falla, la interfaz puede mostrar un estado que no quedó compartido.

**Criterio de cierre:** conservar una copia previa, restaurarla ante error y no mostrar éxito hasta confirmar persistencia.

### 3. Google Calendar all-day y recuperación del botón

Google Calendar trata `end.date` como límite exclusivo. `syncGcalEquipo` recorre actualmente hasta esa fecha incluida, por lo que un evento de día completo puede ocupar un día adicional. Si el guardado final falla, el botón de sincronización puede quedar deshabilitado.

**Criterio de cierre:** restar un día únicamente a `end.date` de eventos all-day y restaurar el botón dentro de `finally`.

## Protección automática

- `tests/equipo-wiring.test.js`
- `.github/workflows/equipo-audit.yml`

Las tres correcciones abiertas están declaradas como pruebas `TODO` para permanecer visibles sin convertir un hallazgo conocido en un falso fallo de integración.

## 2026-10-06 — cierre de rango, rollback, concurrencia y Access

La reauditoría confirmó que los tres defectos abiertos del issue #98 seguían
presentes en el código vigente. Además apareció un cuarto riesgo de integridad:
`saveEquipoEventosAirtable()` reconciliaba la tabla completa contra la copia
local y eliminaba cualquier fila remota ausente. Un navegador desactualizado
podía, por tanto, borrar disponibilidad creada desde otro computador al guardar
un solo día.

### Esquema verificado

Se contrastó en modo sólo lectura la tabla Airtable `Equipo_Eventos`
(`tblqPncBEAShwpMvx`). Tiene 17 registros vigentes y exactamente seis campos:

- `persona_id`
- `fecha`
- `tipo`
- `desc`
- `hora_inicio`
- `hora_fin`

No se modificaron registros durante la auditoría.

### Correcciones

- `saveEquipoEvento()` rechaza `fechaFin < fechaInicio` antes de cerrar el
  modal o persistir.
- Crear, eliminar y el cambio rápido guardan snapshot previo y restauran la UI
  cuando Airtable rechaza la mutación.
- El éxito ya no se muestra antes de confirmar persistencia.
- El respaldo recibe una lista explícita de operaciones y modifica sólo esas
  claves; desaparece el borrado inferido de todas las filas que no estén en la
  copia local.
- Todas las respuestas HTTP de escritura se comprueban y los errores se
  propagan al rollback.
- La carga fallida ya no vacía el estado de disponibilidad ni interpreta un
  403 de Access como una tabla inexistente.
- Google Calendar trata `end.date` de eventos all-day como límite exclusivo:
  un evento de un día ocupa un solo día. `end.dateTime` conserva su semántica
  temporal normal.
- El botón de sincronización se restaura en `finally`, incluso ante error de
  Google o Airtable.
- La sincronización persiste únicamente los días efectivamente importados.

### Cloudflare Access

El esquema ya está clasificado. `operator` obtiene proyección de lectura
limitada a los seis campos revisados y puede crear/editar/eliminar únicamente
registros de `Equipo_Eventos`.

Las escrituras validan:

- persona: `gustavo`, `nicanor` o `florencia`;
- fecha ISO real;
- tipo: `ocupado`, `reunion`, `remoto`, `ausente` o `vacaciones`;
- horas vacías o `HH:MM`;
- descripción acotada;
- `persona_id` y `fecha` son inmutables en PATCH;
- campos nuevos o desconocidos fallan cerrados.

DELETE de `operator` sigue prohibido para CRM, máquinas y el resto de tablas:
la excepción está limitada a un record ID canónico dentro de
`Equipo_Eventos`.

### Cobertura

- `tests/equipo-wiring.test.js`
- `tests/access-operator-mutations.test.js`
- `tests/access-operator-field-scope.test.js`

Los antiguos diagnósticos `todo` de rango invertido, rollback y all-day pasan
a pruebas obligatorias. También se protege contra una futura reintroducción de
la reconciliación destructiva de toda la tabla.
