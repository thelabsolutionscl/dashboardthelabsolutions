# Firmware K1 — cambiar de versión (monocolor / multicolor)

Runbook para actualizar o bajar el firmware de las K1 del taller. Cubre los dos
casos, que **no tienen la misma dificultad**:

| Caso | Qué es | Dificultad |
|---|---|---|
| **A** — subir dentro de la rama monocolor (`1.3.3.5` → `1.3.5.22`) | Actualización normal | Pendrive y listo |
| **B** — bajar de multicolor a monocolor (`2.3.5.xx` → `1.3.5.xx`) | Downgrade entre ramas | La OTA lo rechaza; hay que forzarlo por SSH y se pierde la config |

> **"COLOR" y "MONOCROMÁTICO" no son el tipo de pantalla.** Son dos ramas
> distintas del firmware de Creality: la `2.x` trae soporte multicolor (CFS) y
> la `1.x` es la de un solo material. La pantalla es la misma en ambas.

---

## Paso 0 — Identificar la máquina y su versión real

**No te fíes del número rotulado ni de la memoria.** Pregúntale a la máquina.

IPs según Airtable (tabla `Maquinas`, campo `ip`) — ojo que el dashboard guarda
además una IP por equipo en `localStorage` que pisa a Airtable
(`js/maquinas.js:211`), y que estas IPs son DHCP y pueden cambiar:

| Máquina | IP |
|---|---|
| K1 #1 | 192.168.100.51 |
| K1 #2 | 192.168.100.126 |
| K1 #3 | 192.168.100.7 |
| K1 #4 | 192.168.100.68 |
| K1 #5 | sin IP (en mantención) |

Desde el iMac (que está en `192.168.100.6`, misma red), barrido de qué está encendido:

```bash
for ip in 51 126 7 68; do printf "%s: " $ip; curl -s -m 3 -o /dev/null -w "%{http_code}\n" "http://192.168.100.$ip:7125/printer/info"; done
```

`200` = viva. `000` = apagada o IP cambiada. Para las que respondan:

```bash
ssh root@192.168.100.XX 'cat /etc/ota_info'      # password por defecto: creality
```

```
ota_version=1.3.3.5              ← versión instalada
ota_board_name=CR4CU220812S11    ← código de modelo
ota_compile_time=2024 01.11 18:58:36
```

De acá salen los dos datos que mandan todo lo demás:

- **`ota_version`** define si vas por el caso A o el B.
- **`ota_board_name`** tiene que ser el **prefijo exacto** del `.img` que bajes.
  Flashear el archivo de otro modelo (K1C / K1 Max) es la forma más rápida de
  brickear la máquina.

> Estado verificado el 2026-08-07: la K1 #2 (`192.168.100.126`) está en
> **`1.3.3.5`**, board `CR4CU220812S11`, imagen de enero 2024 — o sea rama
> monocolor antigua, **caso A**. Las #1, #3 y #4 estaban apagadas y no se
> pudieron revisar.

### Descargar el `.img`

Monocolor para board `CR4CU220812S11`:

```
CR4CU220812S11_ota_img_V1.3.5.22.img      (publicado 2026-07-10)
```

[Creality — K1 Downloads Center](https://www.creality.com/download/creality-k1-3d-printer)
· [Creality Cloud — Flagship Series](https://www.crealitycloud.com/downloads/firmware/flagship-series/k1)

### Antes de flashear, en cualquiera de los dos casos

- **Máquina libre**, nunca durante un print: `curl -s "http://$K1:7125/printer/objects/query?print_stats" | grep -o '"state":"[a-z]*"'` → `standby`.
- **Ojo con la mantención de las 9:00** del bridge (`printer-bridge/maint-config.json`):
  saca esa impresora de `printers` mientras dure la intervención.
- **Energía estable.** Un corte a mitad de la OTA deja la máquina en brick.

---

## Caso A — subir dentro de la rama monocolor

Es una actualización normal: la OTA la acepta sin pelear y **no se pierde la
configuración**.

1. Pendrive en **FAT32**, el `.img` en la **raíz**, sin renombrar ni meter en carpetas.
2. Enchúfalo en el puerto USB de la K1.
3. En la pantalla: **Ajustes → Actualizar firmware** → confirmar.
4. Espera a que termine y reinicie sola. No la desenchufes.
5. Verifica: `ssh root@$K1 'cat /etc/ota_info'` → `ota_version=1.3.5.22`.
6. Comprueba en el dashboard (**Máquinas**) que vuelve a salir online, y corre
   `G28` + `BED_MESH_CALIBRATE` (botón 📐) antes de mandarla a producción.

---

## Caso B — bajar de multicolor (2.3.5.x) a monocolor (1.3.5.x)

Creality no soporta este downgrade: la OTA compara versiones y lo rechaza
(`version_is_new`). Hay que forzarlo por SSH, y el proceso **borra el overlay**:
se pierde la config de Moonraker (CORS), macros propias, Helper Script y
Fluidd/Mainsail instalados a mano.

### B.1 — Respaldar

```bash
K1=192.168.100.XX
ssh root@$K1 'tar czf /tmp/backup-k1.tar.gz /usr/data/printer_data/config'
scp -O root@$K1:/tmp/backup-k1.tar.gz ~/Desktop/
```

> **El `-O` no es opcional.** macOS trae OpenSSH 9+, que copia por SFTP, y el
> BusyBox de la K1 no tiene `sftp-server` → `scp: Connection closed`. El `-O`
> fuerza el protocolo SCP clásico. Aplica en las dos direcciones (bajar el
> respaldo y subir el `.img`). Alternativa sin scp:
> `ssh root@$K1 'cat /tmp/backup-k1.tar.gz' > ~/Desktop/backup-k1.tar.gz`

Si el SSH te rechaza, **para acá**: sin acceso root este camino no existe y hay
que ir por soporte Creality. Algunas builds de la rama CFS traen root desactivado.

### B.2 — Dejar el `.img` en la máquina

**Con pendrive:** FAT32, archivo en la raíz, enchufado. Confirma dónde montó:

```bash
ssh root@$K1 'ls /tmp/udisk/*'      # puede ser sda1, sdb1, …
```

**Sin pendrive**, por red a la partición de datos (`/usr/data`, eMMC — **no
`/tmp`**, que es RAM y el `.img` pasa de 100 MB):

```bash
scp -O ~/Downloads/CR4CU220812S11_ota_img_V1.3.5.22.img root@$K1:/usr/data/
ssh root@$K1 'df -h /usr/data'
```

### B.3 — Forzar el downgrade

```bash
ssh root@$K1
```

```bash
rm -rf /overlay/upper/*
mount -o remount,rw /

cp /etc/ota_bin/local_ota_update.sh /tmp/local_ota_update_forced.sh
sed -i 's/exit 1/echo "Ignoring lock..."/g' /tmp/local_ota_update_forced.sh
chmod +x /tmp/local_ota_update_forced.sh

/tmp/local_ota_update_forced.sh /tmp/udisk/sda1/CR4CU220812S11_ota_img_V1.3.5.22.img
# o, si lo copiaste por scp:
# /tmp/local_ota_update_forced.sh /usr/data/CR4CU220812S11_ota_img_V1.3.5.22.img
```

Termina con `ota: stoped success` y reinicia sola. **No cortes la sesión ni la
energía mientras corre.**

### B.4 — Dejarla operativa

1. `ssh root@$K1 'cat /etc/ota_info'` → confirma la versión.
2. **Reponer CORS** en `~/printer_data/config/moonraker.conf` (se borró con el
   overlay), según `printer-bridge/README.md` paso 4:
   ```ini
   [authorization]
   cors_domains:
     *
   trusted_clients:
     127.0.0.1
     192.168.100.0/24
   ```
   y reiniciar Moonraker.
3. Dashboard → **Máquinas** en `🌐 Remoto`: debe salir de "Offline" en ~15 s.
   Si no: `curl http://$K1:7125/printer/info`.
4. `G28` + `BED_MESH_CALIBRATE` y una pieza de prueba.
5. Volver a habilitar la mantención de las 9:00.

No restaures `printer.cfg` del respaldo tal cual — cambió de rama de firmware.
Úsalo solo como referencia para reaplicar lo tuyo.

---

## Si algo sale mal

| Síntoma | Qué hacer |
|---|---|
| La OTA rechaza el archivo aun forzada | Verifica que el prefijo del `.img` coincide con `ota_board_name`. Es el error más común. |
| No hay acceso SSH en la rama CFS | Sin SSH no hay downgrade. Pide a soporte Creality el paquete de recuperación de tu modelo. |
| Se cortó la luz a mitad / no arranca | Recuperación por eMMC con soporte Creality. No insistas con más OTAs. |
| Volvió a la versión vieja pero perdió nivelación / macros | Esperado en el caso B: el overlay se borró. Recalibra y reaplica del respaldo. |
| `curl` da timeout contra una IP | Puede estar apagada o haberle cambiado la IP (DHCP). Revisa con `arp -a \| grep 192.168.100`. |

> **Gotcha de zsh:** en la Terminal del Mac, `VAR=valor   # comentario` **no
> define la variable** (zsh interactivo no acepta comentarios en línea por
> defecto: los lee como comando). Pega los comandos sin comentarios, o corre
> antes `setopt interactive_comments`.

## Fuentes

- [K1 — How to downgrade to monochrome firmware after installing multicolor firmware (foro Creality)](https://forum.creality.com/t/k1-how-to-downgrade-to-monochrome-firmware-after-installing-multicolor-firmware/48449)
- [New K1C firmware v1.3.5.22 (Mono-color) — foro Creality](https://forum.creality.com/t/new-k1c-firmware-v1-3-5-22-mono-color/52410)
- [K1 Max fails to downgrade or update Firmware for CFS-C — Creality-Helper-Script-Wiki #877](https://github.com/Guilouz/Creality-Helper-Script-Wiki/discussions/877) (de aquí sale el forzado por SSH del caso B)
- [Firmware Upgrade Guidance — Creality Wiki](https://wiki.creality.com/en/k1-flagship-series/k1/quick-start-guide/firmware-upgrade-guidance)
