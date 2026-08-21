# Baselines y config drift de impresoras

## Objetivo

Detectar cuándo una impresora deja de coincidir con una configuración previamente aprobada, incluso si todavía sigue imprimiendo aparentemente normal.

El Farm Controller compara dos clases de datos:

- archivos de configuración Klipper/Moonraker (`.cfg` y `.conf`);
- versiones reportadas de Klipper y Moonraker.

## Privacidad y seguridad

El controller **no guarda copias del contenido** de `printer.cfg` ni de otros archivos de configuración. Por cada archivo conserva solamente:

- ruta relativa;
- hash SHA-256.

El dashboard recibe únicamente el hash global, cantidad de archivos y nombres de archivos agregados/removidos/modificados. No recibe el contenido de la configuración.

## Estados

### `clean`

La configuración y versiones actuales coinciden con el baseline aprobado.

### `drift`

Cambió al menos uno de estos elementos:

- hash global de configuración;
- versión de Klipper;
- versión de Moonraker.

Además se informan los archivos `.cfg/.conf` agregados, removidos o modificados.

### `unbaselined`

La máquina fue escaneada correctamente, pero todavía no existe un baseline aprobado.

No se genera un globo de notificación por este estado para evitar alertas masivas durante la instalación inicial.

### `unknown`

No fue posible obtener una lectura completa. Esto no se interpreta como drift. Los problemas de conectividad siguen siendo responsabilidad de FarmHealth.

## API

Mismos roles/tokens del Farm Controller:

```text
GET    /farm/drift                   viewer
POST   /farm/drift/probe             operator
POST   /farm/drift/baseline          admin
DELETE /farm/drift/baseline/:id      admin
```

Ejemplo de aprobación:

```json
{"machineId":"k1-01"}
```

Aprobar un baseline es intencionalmente una operación `admin`: cambia qué estado se considera conocido/bueno.

## Flujo recomendado

1. Dejar la impresora en una configuración que se sabe correcta.
2. Ejecutar **Escanear ahora**.
3. Revisar que la versión/configuración sea la esperada.
4. Pulsar **Aprobar baseline**.
5. Desde ese momento cualquier diferencia aparece como `drift`.
6. Si el cambio fue planificado, probar la impresora y recién después aprobar el nuevo baseline.

Nunca aprobar automáticamente un baseline sólo para hacer desaparecer una alerta.

## Panel de MÁQUINAS

`js/farm-drift-adapter.js` agrega **Integridad de configuración** encima del monitor de Máquinas.

Muestra:

- cantidad de máquinas OK;
- máquinas con drift;
- máquinas sin baseline;
- máquinas sin lectura válida;
- archivos modificados/agregados/removidos;
- cambios de versión Klipper/Moonraker;
- acción explícita para aprobar el estado actual.

El badge de **MÁQUINAS** suma los casos de drift real como advertencias.

## Persistencia

Archivo:

```text
<FARM_DATA_DIR>/drift.json
```

Permisos: `0600`, escritura atómica.

Se almacenan baselines y últimos fingerprints, nunca el contenido de los archivos monitorizados.

## Frecuencia

Por defecto se escanea cada 10 minutos y también se puede forzar desde el dashboard.

Variables opcionales:

```text
FARM_DRIFT_INTERVAL_MS=600000
FARM_DRIFT_TIMEOUT_MS=4000
FARM_DRIFT_MAX_FILES=128
FARM_DRIFT_MAX_FILE_BYTES=2097152
```

## Despliegue

El controller se inicia con:

```bash
node \
  -r farm-production-preload.js \
  -r farm-drift-preload.js \
  -r farm-health-preload.js \
  farm-controller.js
```

Después de sincronizar el iMac, reinstalar/reiniciar el Farm Controller aplica el nuevo preload.
