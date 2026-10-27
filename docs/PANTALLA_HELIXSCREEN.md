# Pantalla táctil con estética TLS — HelixScreen

Runbook para reemplazar la interfaz de fábrica de la pantalla de las impresoras
por [HelixScreen](https://github.com/prestonbrown/helixscreen), con los colores
del dashboard.

> **Estado: plan de piloto, todavía sin probar en el taller.** Escrito el
> 2026-10-27 a partir de la documentación y del instalador de HelixScreen 1.0
> (estable `v1.0.6`), cruzados con lo que ya sabemos del parque
> ([TALLER_IMPRESORAS.md](TALLER_IMPRESORAS.md), [FIRMWARE_K1.md](FIRMWARE_K1.md)).
> Cuando se haga de verdad, corrige aquí lo que haya salido distinto.

Todos los comandos se corren en la Terminal del iMac del taller. Los bloques no
llevan comentarios a propósito: zsh no los acepta al pegarlos.

---

## Qué cambia y qué no

La pantalla de estas máquinas es solo un LCD táctil. La interfaz la dibuja un
programa de Creality (`display-server` en K1/Ender, el servicio `app` en K2)
que corre en la placa principal. HelixScreen **reemplaza ese programa**, no
cambia ningún hardware.

**No toca** Klipper, los `.cfg` ni el firmware. El dashboard, OrcaSlicer y el
Farm Controller siguen hablando con Moonraker en el `7125` igual que hoy.

**Sí toca:**
- Apaga y deshabilita la interfaz de fábrica (reversible).
- Agrega un bloque `[update_manager helixscreen]` a `moonraker.conf` (el Farm
  Controller lo va a marcar como *drift*, ver paso 6).
- En K2: apaga el servicio `app` de Creality, que es también el que maneja la
  cámara y la detección de fallas con IA (ver la tabla).

| Modelo | Soporte HelixScreen | Qué se pierde mientras esté instalado |
|---|---|---|
| K1 #1–#5 | Oficial ("Supported"). Requiere Moonraker, que ya tenemos | Los asistentes de la pantalla de fábrica. Creality Print / Cloud siguen funcionando: el instalador deja vivo el backend de Creality |
| K2 Plus #11, K2 #12–#13 | Oficial ("Tested"), con firmware de fábrica y CFS completo | La app Creality Cloud y su cámara. **La detección de fallas con IA de fábrica** (la documentación de HelixScreen dice en una página que trae su propio detector y en otra que todavía no: confirmarlo en el piloto). Riesgo de que se caiga la cámara del dashboard (`go2rtc` en el `1984`) |
| Ender-5 Max #6–#10 | **No oficial.** Está en su base de modelos y el instalador la detecta como plataforma K1, pero no aparece en la lista de probadas | Lo mismo que la K1, más el riesgo de lo no probado. El panel táctil viene girado 90°: hay que calibrar el toque (paso 4) |

Además, en todas:
- Una actualización OTA de Creality puede devolver la pantalla de fábrica. Hay
  que reinstalar HelixScreen después de cada firmware.
- Para poner el **logo** TLS o pantallas propias (por ejemplo, el pedido que se
  está imprimiendo) hay que mantener una versión propia del código (C++/LVGL,
  licencia GPL-3) y compilarla para MIPS y ARM. Este runbook cubre solo los
  colores, que se cambian sin compilar nada.

---

## Orden de trabajo

No se instala en todo el parque de una vez. Una máquina por modelo, con la
máquina libre:

1. **Una K1 sana** (la #1 o la #2). No la #3 ni la #4 mientras sigan con el
   injerto de Moonraker del Caso 1b/1c: primero se reflashean.
2. **La K2 Plus #11.** Es la que más pierde (cámara, IA), así que se evalúa con
   calma antes de tocar las K2.
3. **Una Ender-5 Max** (la #6), solo si las dos anteriores salieron bien.
4. Si después de una semana de producción no hubo problemas: el resto, de a una.

---

## Paso 0 — Descargar HelixScreen en el iMac (una vez)

Las K1 no descargan por HTTPS y las K2 no traen `wget` ni `curl`, así que se baja
todo en el iMac desde GitHub y después se copia por la red. Siempre la versión
**estable** (en [Releases](https://github.com/prestonbrown/helixscreen/releases/latest),
la que no dice *beta* ni *pre-release*):

```bash
cd ~/dashboardthelabsolutions && git pull
mkdir -p ~/helixscreen && cd ~/helixscreen
V=v1.0.6
for f in install.sh helixscreen-k1.zip helixscreen-k2.zip; do curl -fLO "https://github.com/prestonbrown/helixscreen/releases/download/$V/$f"; done
ls -lh
```

Los tres archivos tienen que existir y los `.zip` pesar varios MB. Si `curl`
falla o uno sale de pocos bytes, esa versión no existe: revisa el número en la
página de Releases.

`helixscreen-k1.zip` sirve para K1 **y** Ender-5 Max (las dos son MIPS);
`helixscreen-k2.zip` para K2 y K2 Plus (ARM). **No se cruzan.**

---

## Paso 1 — Preflight de cada máquina

```bash
IP=192.168.100.51
curl -s "http://$IP:7125/printer/objects/query?print_stats" | grep -o '"state": *"[a-z]*"'
curl -s "http://$IP:7125/server/info" | grep -o '"klippy_state": *"[a-z]*"'
ssh root@$IP 'echo SSH OK; df -h /usr/data /mnt/UDISK 2>/dev/null'
```

1. `print_stats` tiene que decir `standby` y `klippy_state` `ready`.
2. SSH tiene que entrar sin pedir contraseña (el iMac ya tiene llave en el
   parque; si no, `printer-bridge/install-printer-keys.sh`).
3. Saca la máquina de `printer-bridge/maint-config.json` mientras dure (la
   rutina de las 9:00 hace `FIRMWARE_RESTART` y calibra).
4. **Anota cómo está la cámara hoy**, para comparar después.

   K1 / Ender-5 Max:

   ```bash
   curl -s -m 8 -o /dev/null -w "%{http_code} %{content_type}\n" "http://$IP:8080/?action=snapshot"
   ```

   K2 / K2 Plus:

   ```bash
   curl -s -m 20 -o /dev/null -w "%{http_code} %{content_type}\n" "http://$IP:1984/api/frame.jpeg?src=k2plus"
   ```

5. Respaldo de la configuración.

   K1 / Ender-5 Max:

   ```bash
   ssh root@$IP 'tar czf - -C /usr/data/printer_data config' > ~/Desktop/config-$IP.tar.gz
   tar tzf ~/Desktop/config-$IP.tar.gz | head
   ```

   K2 / K2 Plus:

   ```bash
   ssh root@$IP 'tar czf - -C /mnt/UDISK/printer_data config' > ~/Desktop/config-$IP.tar.gz
   tar tzf ~/Desktop/config-$IP.tar.gz | head
   ```

---

## Paso 2 — Instalar en K1 / Ender-5 Max

Copiar los archivos (por `ssh … cat`, que no depende de `scp -O`):

```bash
cd ~/helixscreen
ssh root@$IP 'cat > /usr/data/install.sh' < install.sh
ssh root@$IP 'cat > /usr/data/helixscreen-k1.zip' < helixscreen-k1.zip
ssh root@$IP 'ls -l /usr/data/install.sh /usr/data/helixscreen-k1.zip'
ls -l install.sh helixscreen-k1.zip
```

Los tamaños tienen que coincidir entre la impresora y el iMac. Instalar **desde
una sesión SSH abierta**, porque el instalador puede hacer preguntas:

```bash
ssh root@$IP
sh /usr/data/install.sh --local /usr/data/helixscreen-k1.zip
```

En las primeras líneas tiene que decir `Platform: … K1` y
`K1 firmware: Guilouz Helper Script` (o `Stock Klipper`). Si dice otra
plataforma, **corta con Ctrl-C**: no es el paquete correcto.

Qué hace el instalador en esta plataforma:
- Detiene `Monitor` y `display-server` y quita el permiso de ejecución a
  `/etc/init.d/S99start_app` (no lo borra).
- Instala en `/usr/data/helixscreen/` con arranque en `/etc/init.d/S99helixscreen`.
- Crea `/etc/init.d/S99creality-backend` para que Creality Print / Cloud sigan
  llegando a la máquina.
- En firmware de fábrica, el SSH (dropbear) lo levantaba `S99start_app`; si no
  hay otro script de dropbear, el instalador crea `/etc/init.d/S50dropbear` para
  que no se pierda. **Igual se comprueba en el paso 6, antes de reiniciar.**

---

## Paso 3 — Instalar en K2 / K2 Plus

Igual, pero en la partición grande (`/mnt/UDISK`) y con el paquete ARM:

```bash
cd ~/helixscreen
ssh root@$IP 'cat > /mnt/UDISK/install.sh' < install.sh
ssh root@$IP 'cat > /mnt/UDISK/helixscreen-k2.zip' < helixscreen-k2.zip
ssh root@$IP 'ls -l /mnt/UDISK/install.sh /mnt/UDISK/helixscreen-k2.zip'
ssh root@$IP
sh /mnt/UDISK/install.sh --local /mnt/UDISK/helixscreen-k2.zip
```

Queda en `/mnt/UDISK/helixscreen/` con arranque en `/etc/init.d/S99helixscreen`.
Deshabilita el servicio de fábrica `/etc/init.d/app` y vuelve a levantar el
`web-server` de Creality (puerto `9999`) cada vez que arranca.

**La cámara:** HelixScreen se queda con la cámara interior para su propio
stream (la registra en Moonraker como *HelixScreen Camera*). Nuestro puente
`k2rtc.py → go2rtc` lee el WebRTC del software de fábrica que se acaba de
apagar, así que **lo esperable es que el `1984` deje de dar imagen**. Se
comprueba en el paso 6 y, si pasa, el dashboard tendría que leer la cámara que
publica Moonraker (`/server/webcams/list`) en vez del `1984`. Ese cambio va en
`_defaultCamUrl` de `js/maquinas.js` y se decide con el resultado del piloto.

---

## Paso 4 — Asistente en la pantalla

Al terminar, HelixScreen arranca solo y muestra un asistente:

1. **Idioma:** Español.
2. **Moonraker:** `localhost`, puerto `7125` (lo detecta solo).
3. **Modelo:** lo identifica solo. Si se equivoca, después se corrige tocando la
   imagen de la impresora en el inicio (**Gestor de Impresora** → fila del modelo).
4. **Hardware:** calefactores, ventiladores, sensores. Acepta lo detectado.

**Si el toque no coincide con lo que tocas** (esperable en la Ender-5 Max, cuyo
panel táctil va girado 90° respecto a la pantalla): **Ajustes → Toque y entrada
→ Calibración Táctil**, tres cruces, 7 toques en cada una, y **Aceptar** solo si
en la pantalla de verificación los toques caen donde corresponde.

En **Ajustes → Idioma y hora → Zona horaria** pon `America/Santiago`, para que
las horas de término coincidan con las del dashboard.

---

## Paso 5 — Colores TLS

El tema está en este repo: [`docs/helixscreen/tls.json`](helixscreen/tls.json)
(fondo `#0a0a0a`, acento cian `#00d4cc`, naranja `#ff6b35`: los mismos tokens que
`styles.css`). Se copia a la carpeta de temas de la máquina.

K1 / Ender-5 Max:

```bash
D=/usr/data/helixscreen/config/themes
```

K2 / K2 Plus:

```bash
D=/mnt/UDISK/helixscreen/config/themes
```

Y después, en las dos:

```bash
ssh root@$IP "mkdir -p $D && cat > $D/tls.json" < ~/dashboardthelabsolutions/docs/helixscreen/tls.json
ssh root@$IP '/etc/init.d/S99helixscreen restart'
```

En la pantalla: **Ajustes → Apariencia → Colores del Tema → Preajuste de Tema →
The Lab Solutions → Aplicar.** Es solo modo oscuro, como el dashboard.

Si un texto no se lee bien, se ajusta ahí mismo con **Editar** (16 colores y 4
deslizadores) y **Guardar**. Después se copia el `tls.json` corregido de vuelta
al repo, para que todas queden iguales:

```bash
ssh root@$IP "cat $D/tls.json" > ~/dashboardthelabsolutions/docs/helixscreen/tls.json
```

En las K1 y Ender deja **Animaciones** apagado: es la plataforma con menos
memoria (256 MB).

---

## Paso 6 — Verificar antes de devolverla a producción

Hacer **todo** esto. Lo más importante es el reinicio, porque comprueba que la
máquina vuelve sola con SSH, Moonraker y cámara.

En una K1 o Ender, **antes de reiniciar**, confirma que quedó un arranque de
SSH ejecutable (`S50dropbear` u otro con `dropbear` en el nombre, con permiso
`x`):

```bash
ssh root@$IP 'ls -l /etc/init.d/ | grep -i -E "dropbear|start_app|helix|creality"'
```

Si no hay ninguno de dropbear ejecutable, **no reinicies**: desinstala (ver
*Volver a la pantalla de fábrica*) y anota el caso aquí.

Reiniciar y esperar 2-3 minutos:

```bash
ssh root@$IP 'reboot'
```

```bash
ssh root@$IP 'echo SSH OK; /etc/init.d/S99helixscreen status'
curl -s "http://$IP:7125/server/info" | grep -o '"klippy_state": *"[a-z]*"'
```

1. La pantalla muestra HelixScreen con los colores TLS y responde bien al toque.
2. **SSH entra después del reinicio.** Sin SSH no funciona **🔧 Recuperar
   telemetría** del bridge (ver *Problemas conocidos*).
3. Moonraker `ready`, y en el dashboard (**Máquinas**, `🌐 Remoto`) la máquina
   sale de "Offline" en unos 15 s.
4. **Cámara:** repite el `curl` del paso 1 y compara. En K1/Ender, si el `8080`
   murió, revisa que `cam_app` siga corriendo, porque `mjpg_streamer` lee de él:
   `ssh root@$IP 'ps | grep [c]am_app'`. En K2, ver la nota del paso 3.
5. **Respaldo de `moonraker.conf`:** el instalador lo modificó, así que se
   renueva el respaldo que usa el bridge para recuperar la telemetría.

   K1 / Ender-5 Max:

   ```bash
   ssh root@$IP 'cd /usr/data/printer_data/config && cp moonraker.conf .moonraker.conf.bkp'
   ```

   K2 / K2 Plus:

   ```bash
   ssh root@$IP 'cd /mnt/UDISK/printer_data/config && cp moonraker.conf .moonraker.conf.bkp'
   ```

6. **Config drift:** el Farm Controller va a mostrar la máquina en `drift` por
   ese cambio en `moonraker.conf`. Es esperado: un admin aprueba el nuevo
   baseline (`POST /farm/drift/baseline`, ver [FARM_CONFIG_DRIFT.md](FARM_CONFIG_DRIFT.md)).
7. Una pieza chica de prueba completa, mandada desde OrcaSlicer, mirando que la
   pantalla muestre avance y temperaturas. En K2 con CFS, que muestre los
   slots y cargue/descargue.
8. Devolver la máquina a `maint-config.json`.

---

## Paso 7 — Extender al resto

Solo con el piloto de ese modelo aprobado. Se repiten los pasos 1 a 6 por
máquina; el paso 6 no se salta, aunque las anteriores hayan salido bien.
Anota en la tabla del parque de [TALLER_IMPRESORAS.md](TALLER_IMPRESORAS.md)
cuáles tienen HelixScreen.

---

## Volver a la pantalla de fábrica

Rápido y sin tocar el firmware. El instalador se copia a `/tmp` porque se
niega a desinstalar corriendo desde su propia carpeta.

K1 / Ender-5 Max:

```bash
ssh root@$IP 'cp /usr/data/helixscreen/install.sh /tmp/install.sh && sh /tmp/install.sh --uninstall'
```

K2 / K2 Plus:

```bash
ssh root@$IP 'cp /mnt/UDISK/helixscreen/install.sh /tmp/install.sh && sh /tmp/install.sh --uninstall'
```

Restaura la interfaz que había antes. En K2 además reactiva `/etc/init.d/app` y
devuelve la cámara al software de fábrica, y con eso vuelve la detección IA de
Creality. Después: renovar `.moonraker.conf.bkp` y aprobar el baseline otra vez
(paso 6, puntos 5 y 6).

A mano en una K1 o Ender, si el desinstalador falla:

```bash
ssh root@$IP '/etc/init.d/S99helixscreen stop; rm /etc/init.d/S99helixscreen; rm -rf /usr/data/helixscreen; chmod +x /etc/init.d/S99start_app; reboot'
```

---

## Actualizar HelixScreen

K1 / Ender-5 Max: se descarga la versión nueva en el iMac (paso 0, con el `V=`
nuevo), se copia el `.zip` como en el paso 2 y:

```bash
ssh root@$IP 'sh /usr/data/helixscreen/install.sh --local /usr/data/helixscreen-k1.zip --update'
```

K2 / K2 Plus (descarga sola, por Python):

```bash
ssh root@$IP '/mnt/UDISK/helixscreen/install.sh --update'
```

Conserva la configuración y el tema. **Después de cada OTA de Creality**,
comprueba que siga HelixScreen en la pantalla; si volvió la de fábrica,
reinstala desde el paso 2 o 3.

---

## Problemas conocidos

| Síntoma | Causa / solución |
|---|---|
| El instalador dice que Moonraker *does not appear to be running* | Esa máquina no tiene Moonraker sano. Arreglarlo primero ([TALLER_IMPRESORAS.md](TALLER_IMPRESORAS.md), Caso 1). |
| El instalador detecta otra plataforma | Paquete equivocado (`k1` en una K2 o al revés). Ctrl-C y usar el `.zip` correcto. |
| Pantalla en negro después de instalar | Revisar `/usr/data/helixscreen/logs/launcher.log` (K2: `/mnt/UDISK/helixscreen/logs/launcher.log`) con `tail -100`. Si no se resuelve, desinstalar. |
| Los toques caen en otro lado o girados | Calibración táctil (paso 4). Si no se puede navegar, reiniciar la máquina; si sigue, desinstalar por SSH. |
| No entra SSH después de reiniciar (K1/Ender) | `S99start_app` era quien levantaba dropbear en firmware de fábrica y el script que debía reemplazarlo no quedó. Sin SSH no se puede desinstalar: la salida es el firmware de recuperación de Creality por pendrive FAT32, que deja la máquina de fábrica, y después rehacer root, Moonraker y cámara. Por eso se revisa dropbear antes del reinicio de prueba (paso 6) y se hace en el piloto, con la máquina libre. |
| La cámara del dashboard dice "sin señal" (K2) | Esperable: se apagó el software de fábrica que alimenta `k2rtc.py`. Ver la nota del paso 3. |
| Drift en el Farm Controller | Esperable tras instalar o desinstalar. Aprobar el baseline. |

## Fuentes

- [HelixScreen — repositorio y releases](https://github.com/prestonbrown/helixscreen)
- HelixScreen, guías incluidas en el repositorio (`docs/user/guide/`):
  `install-k1.md`, `creality-k1c-setup.md`, `install-k2.md`,
  `supported-printers.md`, `touch-calibration.md`, `settings/appearance.md`
- Instalador de HelixScreen (`scripts/lib/installer/`): `platform.sh` (detección
  K1 por sistema de archivos), `competing_uis.sh` (qué apaga y cómo lo revierte),
  `camera.sh`, `moonraker.sh`
