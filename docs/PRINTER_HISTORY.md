# Historial y odómetro durable de la granja 3D

## Objetivo

`maquinas.js` históricamente guardaba `printer_history_v1` y `printer_odometer_v1` sólo en `localStorage`. Eso servía como caché rápida, pero cambiar de navegador, limpiar datos del sitio o perder el equipo podía dejar incompletas las horas acumuladas de una impresora.

El almacenamiento durable mantiene esa copia local como fallback, pero usa el Farm Controller como fuente compartida.

## Archivos

- `printer-bridge/data/production.json` en ejecución manual/desarrollo.
- `~/Library/Application Support/TheLabFarm/production.json` con el LaunchAgent de macOS.
- `/var/lib/thelab-farm/production.json` con el servicio systemd de referencia.

El archivo se escribe de forma atómica y con permisos `0600`.

## API

Con el mismo token del bridge:

```text
GET  /farm/production
POST /farm/production/migrate
POST /farm/production/events
```

`GET` requiere rol `viewer`. Las escrituras requieren `operator` o superior.

### Migración

El primer navegador que se conecta envía su historial local y su odómetro acumulado. El servidor:

1. deduplica los cierres de impresión;
2. conserva el mayor acumulado conocido por máquina;
3. no vuelve a sumar eventos que ya estaban incluidos en el odómetro local;
4. devuelve el snapshot canónico para refrescar la caché del navegador.

Si `production.json` se pierde o un controller nuevo arranca vacío, una caché local no vacía puede volver a sembrarlo automáticamente.

## Semántica de métricas

Por máquina se conservan:

- `hours`: horas de impresiones completadas;
- `prints`: impresiones completadas;
- `failures`: sesiones cerradas sin estado `Completado`;
- `filamentMm`: filamento observado tanto en trabajos completados como cancelados;
- historial reciente de cierres de impresión.

El servidor conserva hasta 5.000 eventos por defecto (`FARM_PRODUCTION_HISTORY_LIMIT`). El odómetro es acumulativo y no depende de ese límite.

## Idempotencia

Un evento se identifica por máquina + archivo + inicio + fin + resultado. Si dos navegadores observan el mismo cierre, el segundo reporte no incrementa horas, impresiones ni filamento otra vez.

## Dashboard

El módulo `js/printer-history-adapter.js` envuelve `saveHistoryEntry()` después de `maquinas.js` y mantiene `localStorage` como caché compatible con las funciones existentes de mantenimiento y analítica.

Desde DevTools:

```js
PrinterHistory.status()
```

Estados esperados:

- `durable`: controller disponible y sincronizado;
- `local-fallback`: controller no disponible; se sigue registrando localmente;
- `checking`: todavía no termina la primera sincronización.

## Arranque del controller

El LaunchAgent y el servicio systemd cargan el almacén mediante Node preload:

```bash
node -r ./printer-bridge/farm-production-preload.js ./printer-bridge/farm-controller.js
```

El instalador macOS utiliza el LaunchAgent actualizado, por lo que no requiere pasos manuales adicionales después de sincronizar el repositorio y reinstalar el Farm Controller.
