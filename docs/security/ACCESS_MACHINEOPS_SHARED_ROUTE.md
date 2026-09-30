# MachineOps fuera del acceso genérico a Monitor Sistema

MachineOps y el historial compartido de nivelación usan ahora
`GET/PUT /shared/machineops`. El navegador no necesita listar ni escribir la
tabla completa `Monitor Sistema`.

## Datos expuestos

La lectura normal devuelve únicamente los registros allowlisted
`MACHINE_OPS_V3:<dominio>` y `MACHINE_OPS_V3:meta`. Si V3 aún no está
confirmado, el servidor puede entregar `MACHINE_OPS_V2` como fallback de
migración. Los IDs internos de Airtable nunca llegan al navegador.

`BED_LEVEL_HISTORY_V2` usa la misma ruta con
`record=BED_LEVEL_HISTORY_V2`, separado del snapshot operacional.

## Permisos

Con Cloudflare Access activo:

- `operator` y `admin` pueden leer MachineOps.
- `operator` puede modificar dominios operativos (trabajos, rollos, QA,
  incidentes, auditoría, acknowledgements, perfiles de laminado, lecturas de
  seguridad e historial de nivelación).
- Sólo `admin` puede modificar `automation`, `costConfig`,
  `safetyConfig` y `maintenanceProfiles`.
- `viewer`, `sales` y `finance` no reciben esta ruta.

El frontend replica la restricción de configuración mediante
`RBAC.canConfigRole`, pero la autorización definitiva ocurre en el Worker.

## Concurrencia y recuperación

Cada dominio usa una revisión SHA-256 independiente. El Durable Object
`tls-shared-machineops` serializa las escrituras: dos cambios sobre el mismo
dominio compiten por CAS, mientras cambios sobre dominios distintos no generan
conflictos falsos.

El servidor escribe sólo dominios modificados y publica `meta` al final.
Cada envelope conserva, cuando cabe, el snapshot anterior. Esto mantiene la
recuperación ya existente del adaptador si una escritura queda a mitad de un
commit. Timeout, redirección o 5xx se consideran resultado incierto y no se
repiten a ciegas; el cliente relee antes de un nuevo intento.

## Compatibilidad verificada

Antes del cambio se validaron en modo lectura todos los registros reales:
`MACHINE_OPS_V2`, los dominios V3, `MACHINE_OPS_V3:meta` y
`BED_LEVEL_HISTORY_V2`. Todos cumplen los límites y esquemas nuevos, por lo
que esta etapa no requiere migrar, borrar ni reescribir datos de producción.
