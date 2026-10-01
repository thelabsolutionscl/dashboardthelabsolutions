# Observabilidad central de la granja 3D

## Objetivo

La cola, el registry, la seguridad y el historial ya son persistentes, pero una falla podía seguir descubriéndose tarde: una impresora sin Moonraker, Klipper en `shutdown`, un JSON corrupto o un trabajo atascado sólo se veía cuando alguien abría el dashboard o intentaba imprimir.

El monitor de salud vive dentro del Farm Controller, por lo que funciona aunque no haya ningún navegador abierto.

## Componentes

- `printer-bridge/farm-health-preload.js`: monitor central y API.
- `js/farm-health-adapter.js`: cliente del dashboard.
- `health.json`: acknowledgements e historial de transiciones de alerta.

El estado instantáneo de las impresoras no necesita persistirse: se reconstruye con probes periódicos. Lo que sí se conserva son las aperturas/cierres de alertas y sus acknowledgements.

## Qué vigila

Cada 30 segundos por defecto:

- reachability de Moonraker en cada IP canónica del registry;
- estado de Klipper mediante `/printer/info`;
- frescura del registry;
- integridad JSON de `registry.json`, `queue.json`, `safety.json` y `production.json`;
- capacidad de escritura del directorio persistente;
- trabajos que permanecen demasiado tiempo en estados intermedios/retry;
- snapshot de seguridad stale cuando existe un trabajo que puede ser desatendido.

Para evitar falsos positivos por una pérdida puntual de red, una máquina pasa a `offline` después de dos probes fallidos consecutivos por defecto.

## Severidades

### Critical

- impresora offline confirmada;
- Klipper en `shutdown` o `error`;
- archivos persistentes corruptos;
- directorio de datos no escribible.

### Warning

- primer probe fallido;
- IP ausente/no privada en registry;
- registry stale;
- trabajo atascado;
- seguridad desatendida stale cuando puede bloquear un trabajo.

## API

Con el mismo esquema de roles del Farm Controller:

```text
GET  /farm/health        viewer
POST /farm/health/probe  operator
POST /farm/health/ack    operator
```

`GET /farm/health` devuelve:

- `summary`: estado agregado y conteos;
- `machines`: salud por impresora;
- `alerts`: alertas activas con severidad y acknowledgement;
- `sources`: salud de los archivos persistentes;
- `events`: últimas transiciones opened/resolved.

## Dashboard

Desde DevTools:

```js
FarmHealth.status()
```

Estados del cliente:

- `central`: Farm Controller disponible y snapshot recibido;
- `unavailable`: no se pudo consultar el controller;
- `checking`: todavía no termina la primera lectura.

Acciones manuales:

```js
await FarmHealth.refresh(true)
await FarmHealth.probe()
await FarmHealth.ack('machine:k1-01:offline')
```

El navegador sólo consume el estado: el polling real de las impresoras ocurre en el controller.

## Configuración opcional

```text
FARM_HEALTH_INTERVAL_MS=30000
FARM_HEALTH_PROBE_TIMEOUT_MS=2500
FARM_HEALTH_OFFLINE_FAILURES=2
FARM_HEALTH_REGISTRY_STALE_MS=1800000
FARM_HEALTH_SAFETY_STALE_MS=180000
FARM_HEALTH_STUCK_JOB_MS=1200000
FARM_HEALTH_EVENT_LIMIT=1000
```

Los mínimos internos evitan configurar intervalos peligrosamente agresivos.

## Despliegue

El LaunchAgent macOS y el servicio systemd cargan ambos preloads antes del controller:

```bash
node -r farm-production-preload.js -r farm-health-preload.js farm-controller.js
```

Después de sincronizar el repositorio, reinstalar/reiniciar el Farm Controller aplica la observabilidad sin cambios adicionales en las impresoras.

## Verificación

1. `GET /farm/health` responde `ok:true` con token válido.
2. Una impresora accesible aparece `online:true`.
3. Un corte temporal de un solo probe queda `degraded`; el segundo fallo consecutivo eleva `offline`.
4. Al volver Moonraker, la alerta se resuelve y se agrega un evento `resolved`.
5. `FarmHealth.status().mode` cambia a `central` en el dashboard.
