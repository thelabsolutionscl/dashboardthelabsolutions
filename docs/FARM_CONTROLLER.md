# Farm Controller — despliegue seguro y migración

Este documento cubre el despliegue del Farm Controller que se coloca delante del `printer-bridge` existente.

## Qué cambia

Antes:

`Dashboard -> Cloudflare Tunnel -> printer-bridge:8347 -> impresoras`

Después:

`Dashboard -> Cloudflare Tunnel -> farm-controller:8347 -> printer-bridge interno:8348 -> impresoras`

El controller agrega:

- cola de impresión durable en disco;
- registry persistente de impresoras e historial de IP;
- discovery de Moonraker en la LAN;
- autorización por roles `viewer`, `operator` y `admin`;
- CORS restringido al dashboard;
- compatibilidad con las rutas antiguas del bridge.

El bridge legado sigue existiendo, pero el controller lo inicia como proceso hijo sólo en el puerto interno configurado (por defecto `8348`) con un token interno efímero.

## Archivos persistentes

En macOS el instalador usa por defecto:

`~/Library/Application Support/TheLabFarm/`

Ahí quedan `queue.json`, `registry.json` y los logs del controller. No se deben guardar estos archivos en Git.

En Linux se recomienda `/var/lib/thelab-farm` con permisos sólo para el usuario del servicio.

## Tokens y roles

Variables soportadas:

- `BRIDGE_VIEWER_TOKEN`: lectura de telemetría/estado.
- `BRIDGE_OPERATOR_TOKEN`: además permite operaciones de impresión y cola.
- `BRIDGE_ADMIN_TOKEN`: recuperación, actualización, mantenimiento y administración del registry.
- `BRIDGE_TOKEN`: compatibilidad. Si no existe `BRIDGE_ADMIN_TOKEN`, el token existente actúa como admin.

Durante el primer piloto en el iMac se recomienda **mantener el token actual** para no cambiar dashboard + bridge + credenciales al mismo tiempo. Una vez estable, separar viewer/operator/admin en una segunda fase.

Nunca pegar tokens en commits, issues, PRs o logs compartidos.

## Piloto en el iMac actual

No hacer merge a `main` para probar. Primero usar la rama del PR.

```bash
cd ~/Desktop/dashboardthelabsolutions
git fetch origin
git switch feature/farm-robustness-1-4
git pull --ff-only origin feature/farm-robustness-1-4
bash printer-bridge/install-farm-controller.sh
```

El instalador:

1. detecta si el `printer-bridge` antiguo estaba cargado;
2. genera un LaunchAgent con las rutas reales de Node y del repositorio;
3. detiene el servicio antiguo para liberar `8347`;
4. arranca `farm-controller`;
5. prueba `/healthz` durante varios segundos;
6. si la prueba falla, detiene el controller y restaura automáticamente el bridge anterior.

### Smoke tests locales

```bash
curl -s http://127.0.0.1:8347/healthz
curl -s "http://127.0.0.1:8347/authcheck?bt=TU_TOKEN"
```

`/healthz` debe devolver `ok: true` y `service: farm-controller`.

`/authcheck` debe devolver `ok: true` y un rol válido.

### Probar registry

```bash
curl -s "http://127.0.0.1:8347/farm/registry?bt=TU_TOKEN"
```

Para iniciar discovery manual se requiere rol admin:

```bash
curl -s -X POST "http://127.0.0.1:8347/farm/discover?bt=TU_TOKEN"
```

Después de unos segundos, volver a consultar `/farm/registry` y comprobar que aparecen impresoras con IP/hostname y, cuando Moonraker lo expone, MAC/versiones.

### Probar persistencia de cola sin imprimir

La prueba inicial debe hacerse con un G-code de prueba y una impresora disponible. Antes de enviar producción real:

1. verificar que la impresora aparece libre en el dashboard;
2. crear un trabajo de prueba;
3. confirmar que aparece en `/farm/queue`;
4. reiniciar únicamente el controller;
5. comprobar que el trabajo sigue en `/farm/queue`.

La persistencia está en disco: cerrar o recargar el navegador no debe borrar la cola.

## Cloudflare Tunnel

El origen público debe seguir apuntando a:

`http://127.0.0.1:8347`

Si el túnel ya apunta a ese origen en el iMac, no debería requerir cambio de puerto. La diferencia es qué proceso escucha en `8347`.

Después del cambio comprobar desde fuera de la LAN:

- dashboard carga telemetría;
- cámaras siguen funcionando;
- `/healthz` del túnel responde;
- una operación no destructiva contra Moonraker funciona;
- sólo entonces probar una impresión corta.

## Rollback macOS

En cualquier momento:

```bash
cd ~/Desktop/dashboardthelabsolutions
bash printer-bridge/rollback-farm-controller.sh
```

Esto detiene el controller, vuelve a cargar `com.thelab.printer-bridge` y comprueba que el viejo `/healthz` responde en `8347`.

Los datos de cola/registry del controller se conservan para diagnóstico; el rollback no los borra.

## Logs macOS

```bash
tail -n 100 "$HOME/Library/Application Support/TheLabFarm/farm-controller.log"
tail -n 100 "$HOME/Library/Application Support/TheLabFarm/farm-controller.err"
launchctl print "gui/$(id -u)/com.thelab.farm-controller"
```

## Migración a hardware dedicado

Después de validar el piloto, mover el controller a un equipo Ethernet siempre encendido (mini-PC/N100/Raspberry Pi) y, preferiblemente, UPS.

Pasos recomendados:

1. instalar Node.js LTS;
2. clonar el repositorio en `/opt/thelab/dashboardthelabsolutions`;
3. crear usuario de servicio sin login, por ejemplo `thelab-farm`;
4. copiar/adaptar `printer-bridge/farm-controller.service`;
5. usar `/var/lib/thelab-farm` para datos persistentes;
6. configurar tokens mediante variables/secretos del servicio, nunca dentro del repo;
7. permitir desde firewall sólo lo necesario hacia la VLAN/subred de impresoras;
8. mover Cloudflare Tunnel al nuevo equipo;
9. validar salud, telemetría, cámaras y una impresión corta;
10. dejar el iMac como cliente/estación de administración, no como controlador obligatorio.

Ejemplo de systemd:

```bash
sudo cp printer-bridge/farm-controller.service /etc/systemd/system/thelab-farm-controller.service
sudo systemctl daemon-reload
sudo systemctl enable --now thelab-farm-controller
sudo systemctl status thelab-farm-controller
```

Antes de usar el archivo de ejemplo, ajustar usuario, rutas y `Environment` a la instalación real.

## Criterio para mergear el PR

No mergear hasta cumplir al menos:

- CI de Máquinas verde;
- CI general sin regresiones atribuibles al PR;
- `/healthz` estable en el iMac;
- dashboard operativo dentro y fuera de la LAN;
- registry/discovery funcionando;
- persistencia de cola comprobada tras reinicio del controller;
- impresión corta exitosa;
- rollback probado al menos una vez.
