# Firmware K1 — cambiar de versión

Runbook para cambiar el firmware de las K1 del taller. Escrito después de hacerlo
de verdad en la **K1 #2** (`192.168.100.126`), que pasó de `1.3.3.5` a `1.3.5.22`
el 2026-08-07.

> **La vía que funciona es por SSH, no por pantalla ni por pendrive.** La app del
> display rechaza imágenes que no le gustan (mensajes tipo "solo puedes actualizar
> a una versión color") y el lector USB puede no detectar el pendrive. El camino
> por línea de comandos evita ambos problemas.

> **"COLOR" y "MONOCROMÁTICO" no son el tipo de pantalla.** Son dos ramas del
> firmware de Creality: la `2.x` trae soporte multicolor (CFS) y la `1.x` es la
> de un solo material. La pantalla es la misma en ambas.

---

## Paso 1 — Qué versión tiene realmente

**No te fíes del rótulo ni de lo que muestra la pantalla.** Pregúntale al sistema:

```bash
K1=192.168.100.126
ssh root@$K1 'sh /etc/ota_bin/get_ota_current_version.sh; sh /etc/ota_bin/get_ota_board_name.sh'
ssh root@$K1 'cat /etc/ota_info'
```

```
1.3.5.22
CR4CU220812S11
```

- La **versión** define si vas a subir o a bajar.
- El **board name** tiene que ser el prefijo exacto del `.img`. Flashear el
  archivo de otro modelo (K1C / K1 Max) es la forma más rápida de brickear.

### La pantalla puede mentir

Lo que muestra **Ajustes → Acerca de** no sale del firmware: sale de
`/usr/data/creality/userdata/config/system_version.json`, campo `sys_version`.
Ese archivo vive en la partición de datos, **el OTA no lo toca**, y se puede
editar a mano.

En la K1 #2 alguien lo había puesto en `2.3.5.33` (multicolor) el 23-06-2026
mientras el rootfs estaba en `1.3.3.5` monocolor. La delató un enlace en formato
Markdown dentro del JSON (`"website":"[www.creality.com](https://…)"`), que
ningún firmware de Creality escribe. Consecuencia práctica: el actualizador del
display comparaba contra una versión inexistente y rechazaba toda imagen
monocromática.

Si el número de la pantalla no coincide con `get_ota_current_version.sh`, manda
el segundo. Para corregirlo (respaldo primero):

```bash
ssh root@$K1 'cp /usr/data/creality/userdata/config/system_version.json /usr/data/creality/userdata/config/system_version.json.bak'
ssh root@$K1 'cat > /usr/data/creality/userdata/config/system_version.json <<EOF
{
  "sys_version":"1.3.5.22",
  "fw_version":"",
  "app_version":1,
  "hw_version":"CR4CU220812S11",
  "hw1_version":"",
  "st_version":"0",
  "website":"www.creality.com"
}
EOF'
ssh root@$K1 'reboot'
```

> **Pendiente:** revisar si las K1 #1, #3 y #4 tienen el mismo archivo alterado.
> Estaban apagadas el 2026-08-07 y no se pudieron comprobar.

IPs del parque (Airtable, tabla `Maquinas`, campo `ip`) — son DHCP y pueden
cambiar; el dashboard además guarda una IP por equipo en `localStorage` que pisa
a Airtable (`js/maquinas.js:211`):

| Máquina | IP |
|---|---|
| K1 #1 | 192.168.100.51 |
| K1 #2 | 192.168.100.126 |
| K1 #3 | 192.168.100.7 |
| K1 #4 | 192.168.100.68 |
| K1 #5 | sin IP (en mantención) |

Password SSH por defecto: `creality`.

## Paso 2 — Descargar el `.img`

Del [centro de descargas de la K1](https://www.creality.com/download/creality-k1-3d-printer)
o de [Creality Cloud](https://www.crealitycloud.com/downloads/firmware/flagship-series/k1).
Solo de dominios oficiales de Creality: ese archivo se escribe directo en la
memoria de la impresora.

Verifica nombre y tamaño (debe rondar los 100–200 MB):

```bash
ls -lh ~/Downloads/CR4CU220812S11_ota_img_V1.3.5.22.img
```

## Paso 3 — Preflight y respaldo

```bash
curl -s "http://$K1:7125/printer/objects/query?print_stats" | grep -o '"state": *"[a-z]*"'
```

Tiene que decir `standby` (Moonraker devuelve el JSON **con espacio** después de
los dos puntos — un `grep '"state":"…"'` sin espacio nunca coincide).

```bash
ssh root@$K1 'tar czf /tmp/backup-k1.tar.gz /usr/data/printer_data/config'
scp -O root@$K1:/tmp/backup-k1.tar.gz ~/Desktop/
tar tzf ~/Desktop/backup-k1.tar.gz | head
```

> **El `-O` no es opcional.** macOS trae OpenSSH 9+, que copia por SFTP, y el
> BusyBox de la K1 no tiene `sftp-server` → `scp: Connection closed`. Alternativa:
> `ssh root@$K1 'cat /tmp/backup-k1.tar.gz' > ~/Desktop/backup-k1.tar.gz`

Si existe `printer-bridge/maint-config.json`, saca esa impresora de la lista
`printers` mientras dure la intervención (la rutina de las 9:00 hace
`FIRMWARE_RESTART` y calibra). Si el archivo no existe, la mantención está
apagada y no hay nada que hacer.

## Paso 4 — Copiar el firmware por red

Sin pendrive: es más confiable y evita que la impresora no lo detecte.

```bash
scp -O ~/Downloads/CR4CU220812S11_ota_img_V1.3.5.22.img root@$K1:/usr/data/
ssh root@$K1 'ls -lh /usr/data/*.img; df -h /usr/data'
```

Va a `/usr/data` (eMMC, ~6.5 GB), **nunca a `/tmp`** (es RAM). Confirma que el
tamaño coincide con el original: si quedó más chico, la copia se cortó.

## Paso 5 — Flashear

En la máquina hay dos scripts:

| Script | Qué hace |
|---|---|
| `/etc/ota_bin/local_ota_update.sh` | El de fábrica. Rechaza bajar de versión (`version_is_new`). |
| `/usr/data/downgrade.sh` | Copia del anterior con el candado de versión removido: descompone la versión en major/minor/patch/build **y no la compara**. El resto de validaciones (md5 de kernel y rootfs, consistencia del `.img`) siguen intactas. |

Para subir de versión sirve cualquiera; para bajar, solo el segundo. Si
`downgrade.sh` no existe en la máquina, se genera así:

```bash
cp /etc/ota_bin/local_ota_update.sh /tmp/local_ota_update_forced.sh
sed -i 's/exit 1/echo "Ignoring lock..."/g' /tmp/local_ota_update_forced.sh
chmod +x /tmp/local_ota_update_forced.sh
```

**Lánzalo con `nohup`.** Las impresoras están por WiFi: si se corta el SSH a
mitad del flasheo, el proceso muere con la sesión y la máquina queda a medias.

```bash
ssh root@$K1 'nohup sh /usr/data/downgrade.sh /usr/data/CR4CU220812S11_ota_img_V1.3.5.22.img > /usr/data/ota.log 2>&1 &'
```

Devuelve el prompt de inmediato. Se sigue desde afuera:

```bash
ssh root@$K1 'tail -30 /usr/data/ota.log; echo "--- proceso ---"; ps | grep -E "downgrade|ota_updater" | grep -v grep'
```

Secuencia esperada: descompresión 7z → las dos versiones (`ota_current_version`
= la del `.img`, `current_version` = la de la máquina) → md5 → `ota: data
processed: N%` → `rootfs update done` → `rtos update done` → **`ota: stoped
success`** → reinicio automático (~2 min).

Mientras corre: no apagar, no desenchufar, no cancelar desde la pantalla.

## Paso 6 — Verificar y dejar operativa

```bash
ssh root@$K1 'uptime; cat /etc/ota_info'
```

Debe mostrar la versión nueva y un uptime bajo. Si sigue la versión vieja y el
uptime es alto, no reinició: `ssh root@$K1 'reboot'` y espera 2-3 minutos.

```bash
ssh root@$K1 'grep -A5 authorization /usr/data/printer_data/config/moonraker.conf'
ssh root@$K1 'ls /usr/data/helper-script >/dev/null 2>&1 && echo "helper-script OK" || echo "helper-script SE PERDIO"'
ssh root@$K1 'rm -f /usr/data/*.img; df -h /usr/data'
curl -s "http://$K1:7125/printer/info"
```

1. El bloque `[authorization]` con `cors_domains: *` tiene que seguir ahí, o el
   dashboard no la ve (ver `printer-bridge/README.md`, paso 4).
2. Dashboard → **Máquinas** en `🌐 Remoto`: debe salir de "Offline" en ~15 s.
3. `G28` + `BED_MESH_CALIBRATE` (botón 📐) con la cama despejada.
4. Pieza chica de prueba antes de producción.
5. Devolver la impresora a `maint-config.json` si la sacaste.

---

## Lo que no hay que hacer

- **`rm -rf /overlay/upper/*`**. Aparece en los tutoriales de downgrade forzado.
  Borra toda modificación de la máquina: Helper Script, Fluidd/Mainsail, macros
  propias y el CORS de Moonraker. **No hizo falta** — el `downgrade.sh` flashea
  sin tocar el overlay. Úsalo solo si el flasheo falla por sistema de archivos
  de solo lectura, y con respaldo hecho.
- **Insistir por la pantalla.** Si la app del display rechaza el archivo, no es
  un veredicto sobre el firmware: la vía por SSH funciona igual.

## Problemas conocidos

| Síntoma | Causa / solución |
|---|---|
| `scp: Connection closed` | Falta el `-O` (SFTP vs SCP clásico). |
| La pantalla rechaza el `.img` | Chequeo de la app del display, que compara contra `system_version.json` — un archivo editable que puede no reflejar el firmware real. Ignóralo y usa SSH. |
| La versión de la pantalla no cambia tras flashear | `system_version.json` vive en `/usr/data` y el OTA no lo toca. Ver "La pantalla puede mentir". |
| `ls /tmp/udisk/` vacío, `Not a file` | La impresora no montó el pendrive. Revisa `dmesg \| tail` y `ls /dev/sd*`; o mejor, copia por red (paso 4). |
| `ls: /usr/data/creality/ota_updater*: No such file` | Mensaje inofensivo de una limpieza previa, no es el punto de falla. |
| `curl` da timeout contra una IP | Apagada o IP cambiada (DHCP). Revisa con `arp -a \| grep 192.168.100`. |
| `zsh: command not found: #` | zsh interactivo no acepta comentarios en línea, y además deja la variable sin definir. Pega los comandos sin comentarios o corre `setopt interactive_comments`. |

## Fuentes

- [K1 — How to downgrade to monochrome firmware after installing multicolor firmware (foro Creality)](https://forum.creality.com/t/k1-how-to-downgrade-to-monochrome-firmware-after-installing-multicolor-firmware/48449)
- [New K1C firmware v1.3.5.22 (Mono-color) — foro Creality](https://forum.creality.com/t/new-k1c-firmware-v1-3-5-22-mono-color/52410)
- [K1 Max fails to downgrade or update Firmware for CFS-C — Creality-Helper-Script-Wiki #877](https://github.com/Guilouz/Creality-Helper-Script-Wiki/discussions/877)
- [Firmware Upgrade Guidance — Creality Wiki](https://wiki.creality.com/en/k1-flagship-series/k1/quick-start-guide/firmware-upgrade-guidance)
