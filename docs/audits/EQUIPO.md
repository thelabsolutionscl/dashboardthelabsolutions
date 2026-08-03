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
