# Confiabilidad histórica de la granja

Las métricas de MÁQUINAS usan `health.json`, `production.json` y `registry.json` para derivar disponibilidad, downtime, utilización, tasa de finalización, incidentes, MTBF y MTTR.

## Cobertura honesta

La ventana se recorta al inicio real de cobertura de `health.json`. Si el monitor lleva tres días, una vista de 30 días no inventa 27 días perfectos.

Sólo se consideran incidentes de indisponibilidad los eventos `machine:<id>:offline`, `machine:<id>:klipper-shutdown` y `machine:<id>:klipper-error`. Un primer probe fallido o una alerta transitoria no reduce disponibilidad.

Los incidentes superpuestos se unen para no contar dos veces el mismo downtime.

## Definiciones

- **Disponibilidad**: tiempo observado sin incidentes offline/Klipper crítico.
- **Utilización**: horas imprimiendo / horas disponibles.
- **Finalización**: trabajos completados / trabajos terminados registrados.
- **MTBF**: horas disponibles / incidentes iniciados.
- **MTTR**: duración media de incidentes resueltos.

No se presenta como OEE estándar porque aún no existe un tiempo ideal de ciclo fiable por trabajo.

## API

`GET /farm/reliability?days=30`

Acepta 1–365 días y requiere rol viewer o superior.

## Reinicios

`farm-health-preload.js` persiste `startedAt` y reconstruye las alertas que seguían abiertas antes de un restart. Reiniciar el controller no debe generar un nuevo `opened` para el mismo incidente.
