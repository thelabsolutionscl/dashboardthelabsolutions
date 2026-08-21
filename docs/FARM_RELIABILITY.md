# Confiabilidad histórica de la granja 3D

## Objetivo

El monitor de salud dice qué ocurre **ahora**. Este módulo responde preguntas históricas:

- ¿qué impresora se cae más?
- ¿cuántas horas estuvo indisponible?
- ¿cuánto tarda normalmente en recuperarse?
- ¿cuánto tiempo pasa realmente imprimiendo?
- ¿qué porcentaje de trabajos termina correctamente?

La fuente es central: `health.json`, `production.json` y `registry.json`. El navegador no mantiene una segunda copia de las métricas.

## Métricas

### Disponibilidad

Tiempo observado sin incidentes que realmente dejan una máquina fuera de producción:

- `machine:<id>:offline`
- `machine:<id>:klipper-shutdown`
- `machine:<id>:klipper-error`

Alertas transitorias como un primer probe fallido no cuentan como downtime.

### Utilización

Horas con trabajos registrados / horas disponibles observadas.

Los intervalos de impresión que se superponen se unen antes de sumar, para no superar artificialmente 100% por eventos duplicados.

### Finalización

Trabajos completados / trabajos terminales registrados en el período.

No se etiqueta como “calidad” porque una cancelación manual también puede terminar como no completada.

### MTBF

`horas disponibles / incidentes iniciados`

Representa el tiempo medio entre fallos observados.

### MTTR

Duración media de los incidentes resueltos. Un incidente todavía abierto suma downtime, pero no entra al promedio de recuperación hasta que se resuelve.

## Por qué no se llama OEE

OEE estándar requiere:

1. disponibilidad;
2. performance respecto de un ciclo ideal;
3. calidad.

Hoy tenemos disponibilidad y resultados reales, pero no un **tiempo ideal de ciclo** confiable por pieza/material/perfil. Mostrar un OEE inventando ese dato sería engañoso. Cuando el slicer/planificador guarde tiempo ideal junto al tiempo real, este módulo puede extenderse a OEE estándar.

## Cobertura histórica

`health.json` ahora guarda `startedAt` y se crea aunque nunca haya existido una alerta. Las ventanas de 7/30/90 días se recortan al inicio real de cobertura.

Ejemplo: si el monitor lleva 4 días activo y el usuario selecciona 30 días, disponibilidad y MTBF usan esos 4 días observados; no asumen que los 26 días anteriores fueron perfectos.

Los archivos `health.json` antiguos se migran de forma conservadora usando el evento más antiguo disponible o el timestamp persistido.

## Continuidad tras reinicio

Antes, un reinicio del Farm Controller podía volver a escribir `opened` para una alerta que seguía activa. El monitor ahora reconstruye el conjunto de alertas abiertas desde el historial antes del primer probe.

Además, el cálculo histórico ignora `opened` duplicados para tolerar logs heredados.

## API

```text
GET /farm/reliability?days=30    viewer
```

`days` se limita entre 1 y 365. El dashboard ofrece accesos rápidos 7 / 30 / 90 días.

Respuesta principal:

```text
summary.availabilityPct
summary.utilizationPct
summary.completionRatePct
summary.incidents
summary.openIncidents
summary.mtbfHours
summary.mttrHours
machines[]
coverage
```

## Dashboard

El panel **📈 Confiabilidad de granja** aparece en MÁQUINAS, bajo Integridad de configuración.

Desde consola:

```js
FarmReliability.status()
await FarmReliability.refresh(true)
FarmReliability.setDays(90)
```

## Despliegue

El controller carga:

```bash
node \
  -r farm-production-preload.js \
  -r farm-drift-preload.js \
  -r farm-health-preload.js \
  -r farm-reliability-preload.js \
  farm-controller.js
```

Después de actualizar el repositorio del host del controller, reinstalar/reiniciar el servicio aplica el preload nuevo.

## Interpretación inicial

Las métricas serán más útiles a medida que se acumule historia. Durante los primeros días:

- MTBF puede aparecer `—` si todavía no ocurrió ningún incidente;
- MTTR puede aparecer `—` si no se resolvió ningún incidente;
- Finalización puede aparecer `—` si no existen trabajos terminales en la ventana;
- esto significa “datos insuficientes”, no cero.
