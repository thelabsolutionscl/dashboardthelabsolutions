# Taller de impresoras — diagnóstico y arreglo

Runbook operativo del parque: qué hacer cuando una impresora desaparece del
dashboard o su cámara deja de verse. Escrito el 2026-08-12 después de resolver
los cuatro casos de esta página en máquinas reales.

Para cambiar la **versión de firmware** de una K1, ver
[FIRMWARE_K1.md](FIRMWARE_K1.md).

---

## El parque

| Máquina | IP | Arquitectura | Sistema | Cámara se publica con |
|---|---|---|---|---|
| K1 #1 | 192.168.100.51 | mips | Buildroot | mjpg_streamer · 8080 |
| K1 #2 | 192.168.100.126 | mips | Buildroot | mjpg_streamer · 8080 |
| K1 #3 | 192.168.100.7 | mips | Buildroot | mjpg_streamer · 8080 |
| K1 #4 | 192.168.100.68 | mips | Buildroot | mjpg_streamer · 8080 |
| K1 #5 | sin IP | — | — | en mantención |
| Ender-5 Max #6 | 192.168.100.67 | mips | Buildroot | mjpg_streamer · 8080 |
| Ender-5 Max #7 | 192.168.100.64 | mips | Buildroot | mjpg_streamer · 8080 |
| Ender-5 Max #8 | 192.168.100.95 | mips | Buildroot | mjpg_streamer · 8080 |
| K2 #12 | 192.168.100.70 | armv7l | Tina/OpenWrt | go2rtc · 1984 |
| K2 #13 | 192.168.100.71 | armv7l | Tina/OpenWrt | go2rtc · 1984 |
| K2 Plus #11 | 192.168.100.75 | armv7l | Tina/OpenWrt | go2rtc · 1984 |

> Esta tabla es del 2026-08-12. Al 2026-08-17 el monitor lista 14 máquinas: se
> sumaron **Ender-5 Max #9 y #10** (la #10 en `192.168.100.162`) y la
> **OrangeStorm Giga**. La lista viva está siempre en el dashboard.
>
> Al 2026-08-19, tras un baile de DHCP: **#8 = `.95`**, **#9 = `.66`**
> (confirmado por Gustavo en el taller — el hostname de Moonraker dice
> `Ender-5` a secas, no numera). La `.90` que apareció un rato ya no está.

> **Las IPs son DHCP y se mueven.** Las de arriba son las del 2026-08-12. La
> fuente viva es Airtable (tabla `Maquinas`, campo `ip`), pero el dashboard
> guarda además una IP por equipo en `localStorage` que la pisa
> (`js/maquinas.js:211`). Antes de dar una máquina por muerta, confirma su IP:
> en la pantalla, **Ajustes → Red**; o barriendo la red por el puerto de
> Moonraker.

Password SSH en todas: `creality`.

> **El iMac del taller ya entra con llave** (enrolado el 2026-08-19 en `.51`,
> `.89`, `.7`, `.68`, `.67`, `.64`, `.95`, `.66`, `.75`). No pide contraseña,
> así que el injerto de una línea del Caso 1b **ya no se cuelga** — el truco de
> dos tiempos del Caso 1d solo hace falta desde una máquina sin llave. Si
> aparece una impresora nueva, enróllala con:
> `ssh-copy-id -o PubkeyAcceptedAlgorithms=+ssh-rsa root@IP`.

### Barrer la red buscando impresoras

```bash
bash -c 'rm -f /tmp/scan.txt; for i in $(seq 2 254); do (curl -s -m 6 -o /dev/null "http://192.168.100.$i:7125/printer/info" && echo "192.168.100.$i" >> /tmp/scan.txt) & done; wait'; sort -t. -k4 -n /tmp/scan.txt
```

El `bash -c` evita la avalancha de mensajes de control de trabajos de zsh. Usa
6 segundos de espera: con 2 no alcanzan las máquinas por WiFi y aparecen y
desaparecen entre corridas.

---

## Caso 1 · La impresora imprime pero el dashboard no la ve

Klipper y Moonraker son dos cosas distintas. **Klipper mueve la máquina;
Moonraker es la API que consulta el dashboard.** Si Moonraker está caído, la
impresora imprime perfectamente y el dashboard la muestra como si estuviera
desenchufada.

Pasó el 2026-08-12 con las K1 #3 y #4: imprimiendo TPU, invisibles.

### Diagnóstico

```bash
K1=192.168.100.68
curl -s -m 10 -o /dev/null -w "%{http_code}\n" "http://$K1:7125/printer/info"
ssh root@$K1 'ps | grep -c "[m]oonraker"'
```

`000` y `0` procesos = Moonraker caído. Si además el `4408` (Fluidd) sí
responde, la máquina está viva y el dashboard debería mostrarla como
**"Telemetría caída"** en ámbar, no como "Sin conexión".

### La causa que ya nos pasó dos veces: falta el archivo de configuración

```bash
ssh root@$K1 'tail -20 /usr/data/printer_data/logs/moonraker.log'
```

```
ConfigError: Configuration File Not Found:
'/usr/data/printer_data/config/moonraker.conf'
```

Moonraker arranca, no encuentra su configuración y se apaga. Arrancar el
servicio otra vez no sirve de nada hasta reponer el archivo.

### Arreglo — desde el dashboard (lo primero que hay que probar)

En la tarjeta ámbar de la máquina: **🔧 Recuperar telemetría**. El bridge del
iMac entra por SSH, repone `moonraker.conf` desde el respaldo si falta,
reinicia el servicio (el nombre correcto según el modelo) y espera a que
Moonraker conteste. No interrumpe una impresión en curso.

Requiere que el bridge del iMac esté **actualizado** (`git pull` + reiniciarlo)
y con **acceso SSH a las impresoras** —una vez—:
`printer-bridge/install-printer-keys.sh`. Si el botón responde *"Este bridge
todavía no sabe recuperar"*, falta esa actualización.

Si el botón falla, dice por qué (SSH rechazado, no hay respaldo del config,
Moonraker no volvió) y se sigue a mano:

### Arreglo — a mano

Si la máquina tiene su propio respaldo (lo mejor):

```bash
ssh root@$K1 'cd /usr/data/printer_data/config && ls -la .moonraker.conf.bkp'
ssh root@$K1 'cd /usr/data/printer_data/config && cp .moonraker.conf.bkp moonraker.conf'
ssh root@$K1 '/etc/init.d/S56moonraker_service start'
```

Si no lo tiene, se copia desde otra K1 sana (el archivo no trae nada propio de
cada máquina):

```bash
ssh root@192.168.100.68 'cat /usr/data/printer_data/config/moonraker.conf' > /tmp/moonraker-k1.conf
wc -l /tmp/moonraker-k1.conf     # ~57 líneas; si sale 0, no copies nada
scp -O /tmp/moonraker-k1.conf root@192.168.100.7:/usr/data/printer_data/config/moonraker.conf
ssh root@192.168.100.7 '/etc/init.d/S56moonraker_service start'
```

Y se le deja respaldo, que es lo que salvó a la otra:

```bash
ssh root@192.168.100.7 'cd /usr/data/printer_data/config && cp moonraker.conf .moonraker.conf.bkp'
```

Verificación:

```bash
curl -s -m 10 -o /dev/null -w "%{http_code}\n" "http://$K1:7125/printer/info"
```

> Un `404` justo después de arrancar es normal: Moonraker todavía está
> registrando sus endpoints y conectándose con Klipper. Espera 15 segundos y
> vuelve a probar. Para ver si está sano de verdad:
> `curl -s "http://$K1:7125/server/info"` → busca `"klippy_state":"ready"`.

### Sobre el arranque automático

En estas máquinas **no existe `/etc/rc.d`**. El prefijo `S56` de
`/etc/init.d/S56moonraker_service` *es* el mecanismo de arranque. Si el script
está ahí, arranca solo — no falta ningún enlace.

### Caso 1b · No se cayó Moonraker: no está instalado (2026-08-19, K1 #3)

El botón de recuperar respondió algo que el runbook no contemplaba:

```
falta /usr/data/printer_data/config/moonraker.conf y no hay respaldo
no se encontro el servicio de Moonraker en esta maquina
```

No faltaba la configuración: faltaba **todo el stack**. Comparando con una
máquina sana se ve de una:

| | K1 #3 (rota) | Ender #6 (sana) |
|---|---|---|
| `/etc/init.d/S56moonraker_service` | ❌ | ✅ |
| `/etc/init.d/S50nginx` | ❌ | ✅ |
| `/usr/data/moonraker/` | ❌ | ✅ (70,7 MB) |
| `printer_data/` | solo `config`, `gcodes`, `logs` | + `database`, `comms`, `certs`, `misc` |

Klipper en cambio estaba intacto **y la máquina imprimiendo al 96%**. Faltaban
archivos del sistema (init scripts), no solo de datos: eso apunta a un firmware
sin el stack de root, no a un borrado. Firmware encontrado: `1.3.5.22`.

**Moonraker no vive en `/usr/share`** — está en `/usr/data/moonraker/`, con su
propio venv. El init script es quien lo dice:
`PROG=/usr/data/moonraker/moonraker-env/bin/python`.

#### El injerto (no toca Klipper: se puede hacer imprimiendo)

```bash
ssh 192.168.100.67 'tar czf - -C /usr/data moonraker' | ssh 192.168.100.7 'tar xzf - -C /usr/data'
ssh 192.168.100.67 'cat /etc/init.d/S56moonraker_service' | ssh 192.168.100.7 'cat > /etc/init.d/S56moonraker_service && chmod +x /etc/init.d/S56moonraker_service'
ssh 192.168.100.67 'cat /usr/data/printer_data/moonraker.asvc' | ssh 192.168.100.7 'cat > /usr/data/printer_data/moonraker.asvc'
ssh 192.168.100.67 'cat /usr/data/printer_data/config/moonraker.conf' > /tmp/mk.conf
sed '/^\[update_manager Creality-Helper-Script\]/,$d' /tmp/mk.conf > /tmp/mk-k1.conf
scp -O /tmp/mk-k1.conf 192.168.100.7:/usr/data/printer_data/config/moonraker.conf
ssh 192.168.100.7 'cd /usr/data/printer_data/config && cp moonraker.conf .moonraker.conf.bkp'
ssh 192.168.100.7 '/etc/init.d/S56moonraker_service start'
```

El tar tarda 2-6 min y **no imprime nada mientras corre** (el CPU mips comprime
lento); no lo cortes. Se le quita el bloque `[update_manager
Creality-Helper-Script]` porque apunta a `/usr/data/helper-script`, que esta
máquina no tiene. Para comprobar qué configuración quedó realmente activa,
pregúntale a Moonraker en vez de leer el archivo:
`curl -s "http://IP:7125/server/config"`.

Sirve entre modelos distintos (la Ender-5 Max le prestó el suyo a una K1):
Moonraker no depende del modelo, habla con Klipper por `/tmp/klippy_uds`.

> Es un injerto, no una reparación de fondo: esa K1 sigue sin nginx ni Fluidd
> (puerto 4408). Lo definitivo es reflashear con el firmware rooteado
> ([FIRMWARE_K1.md](FIRMWARE_K1.md)), con la máquina libre.


### Caso 1c · La misma enfermedad en la K1 #4 (2026-08-19)

Barriendo la red después de arreglar la #3 apareció otra igual: la **K1 #4
(`192.168.100.68`)** sirve su web de fábrica en el puerto 80, tiene SSH
levantado, y **no tiene Moonraker** (7125, 4408, 4409, 8080 y 1984 todos
inaccesibles). Es el mismo cuadro del Caso 1b, así que el arreglo es el mismo
injerto — pero antes hay que instalarle la llave del bridge, porque hoy
responde `Permission denied (publickey,password)`:

```bash
printer-bridge/install-printer-keys.sh --bridge 192.168.100.68
```

#### Identificar qué modelo hay en una IP sin entrar a la máquina

Todas las Creality sirven la misma página en el puerto 80 (`<title>Creality</title>`),
así que el título no distingue nada. **El hash del bundle sí**: es distinto por
familia de firmware.

```bash
curl -s "http://IP/" | grep -o 'app\.[a-f0-9]*\.js' | head -1
```

| Bundle | Modelo |
|---|---|
| `app.b05d1c1a.js` | K1 |
| `app.d82c63bc.js` | Ender-5 Max |

Así se confirmó que la `.68` es la K1 #4 y no la Ender-5 Max #9 que andábamos
buscando: su bundle es el de las K1.

#### Barrer la red desde fuera del taller

El barrido de más arriba necesita estar en la LAN. Desde cualquier parte se
puede hacer por el bridge, que ahora responde **424** cuando la impresora no
contesta (nunca 5xx, porque Cloudflare se los come):

```bash
B=https://printers.thelab.solutions; T=<token del bridge>
for i in $(seq 2 254); do
  (c=$(curl -s -m 6 -o /dev/null -w "%{http_code}" "$B/192.168.100.$i/printer/info?bt=$T")
   [ "$c" = "200" ] && echo "192.168.100.$i") &
done; wait
```

El cuerpo del 424 dice **por qué** falló, y la diferencia importa:
`ECONNREFUSED` = la máquina está viva pero ese servicio no corre;
`EHOSTDOWN` / `EHOSTUNREACH` = la máquina no está en la red.

### Caso 1d · El injerto encadenado se cuelga pidiendo contraseña (2026-08-19)

El 2026-08-19 hicieron falta dos injertos el mismo día: la **Ender-5 Max #9
(`.66`)** —a la que alguien le había borrado medio Moonraker (42 MB de 70, sin
`moonraker-env/bin/` ni la carpeta `moonraker/` del código, pero la
`moonraker.conf` intacta)— y la **K1 #4 (`.68`)**, sin Moonraker del todo como
la #3.

El injerto de una línea del Caso 1b **se cuelga si el iMac entra a las
impresoras con contraseña** (no con llave). El problema es el pipe:

```bash
ssh DONANTE 'tar czf - ...' | ssh PACIENTE 'tar xzf - ...'
```

Las dos conexiones abren a la vez y **chocan pidiendo la clave**: el `ssh` del
paciente la pide y corre su lado (llega a ejecutar el `rm -rf` de la carpeta
vieja), pero el del donante se queda esperando una contraseña que el pipe no
deja escribir. Resultado: cursor congelado, y el paciente con la carpeta ya
borrada y nada nuevo dentro (`du` da 48 K). La pista es justo esa: el `rm` corrió
pero el `tar` no llenó nada.

**El arreglo es partirlo en dos tiempos con un archivo intermedio en el iMac.**
Cada comando pide su clave por separado, sin pisarse:

```bash
ssh DONANTE 'tar czf - -C /usr/data moonraker' > /tmp/mk.tgz
ls -lh /tmp/mk.tgz                       # ~26 MB comprimido; si da 0, algo falló
scp -O /tmp/mk.tgz PACIENTE:/usr/data/
ssh PACIENTE 'tar xzf /usr/data/mk.tgz -C /usr/data && rm /usr/data/mk.tgz && du -sh /usr/data/moonraker'   # debe dar ~70 M
```

El **2026-08-19 por la tarde** apareció una tercera: la **K1 #2**, ahora en
`192.168.100.89` (antes `.126`), otra vez sin stack. Mismo injerto.

**Trampa nueva ahí: las K1 van por WiFi y el `scp` de 26 MB se corta**
(`lost connection`) a media transferencia — a veces hasta un archivo de 1 KB.
No es tamaño, es señal. Se envuelve el `scp` en un bucle que reintenta hasta
que pase entero:

```bash
until scp -O /tmp/mk.tgz IP:/usr/data/; do echo reintentando; sleep 2; done
```

Si se corta muchas veces, acerca la máquina al router o pásale cable.

Para la Ender `.66` bastó eso más la `moonraker.asvc` (su config ya estaba
puesta de un intento anterior). Para la K1 `.68` hizo falta además el init
script y la config sin el bloque helper-script, como en el Caso 1b — pero
copiados con `scp`, no por pipe.

> **Lo definitivo es que el iMac entre con llave, no con contraseña.** Con
> `~/.ssh/config` (`PubkeyAcceptedAlgorithms +ssh-rsa` por el dropbear viejo) y
> la llave copiada a las tres máquinas, el injerto de una línea del Caso 1b
> vuelve a funcionar sin colgarse. Ver `printer-bridge/README.md`.

> **La impresión pausada de la `.68` se perdió en el proceso.** Apareció como
> `cancelled` con los calentadores apagados al terminar. El injerto no toca
> Klipper, así que no se pudo confirmar si la canceló el `idle_timeout` de la
> pausa larga o algo externo. Si vas a injertar una máquina con trabajo pausado,
> asume que ese trabajo puede no sobrevivir.
---

## Caso 2 · La cámara no se ve

Hay **dos arquitecturas distintas** en el parque y cada una falla distinto. El
mensaje de la tarjeta dice cuál es el problema:

| Mensaje en la tarjeta | Significa |
|---|---|
| "Cámara sin señal · verifica la URL" | Hay una URL guardada de tipo MJPEG y no responde |
| "Cámara sin señal · reintentando…" | Es una URL de snapshot (go2rtc) que no responde |

El dashboard trae diagnóstico integrado: en la tarjeta, botón **📷** →
**Probar**. Distingue token inválido, puerto bloqueado, ruta equivocada y
cámara que no contesta.

> Moonraker responde `{"webcams":[]}` en **todas** estas máquinas. No significa
> nada: ninguna publica su cámara a través de Moonraker.

### K1 y Ender-5 Max — mjpg_streamer

`cam_app` toma la cámara y la publica en memoria compartida; `mjpg_streamer` la
sirve por HTTP leyendo de ahí con `input_memfd.so`. Conviven por diseño.

En las Ender-5 Max ya viene corriendo de fábrica. **En las K1 no**, aunque el
binario y los plugins estén instalados.

```bash
K1=192.168.100.126
ssh root@$K1 'LD_LIBRARY_PATH=/usr/lib/mjpg-streamer /usr/bin/mjpg_streamer -b -i "input_memfd.so -t 0" -o "output_http.so -w /usr/share/mjpg-streamer/www/ -p 8080"'
curl -s -m 8 -o /dev/null -w "%{http_code} %{content_type}\n" "http://$K1:8080/?action=snapshot"
```

Esperado: `200 image/jpeg`. URL para el **📷** del dashboard:

```
http://192.168.100.126:8080/?action=stream
```

> **Ya no hace falta pegar esa URL en el 📷 de cada máquina.** Desde el
> 2026-08-19 el dashboard **deriva la cámara sola** de la IP viva y el modelo:
> K1/Ender → MJPEG en `:8080`, K2/K2 Plus → snapshot go2rtc en `:1984`. Toda
> máquina intenta su cámara; la que no transmite muestra "sin señal". Para que
> una aparezca solo hay que **dejar corriendo `mjpg_streamer`** (comando de
> arriba) — el 📷 queda para casos raros (una IP de cámara distinta, otro
> stream). El default por modelo vive en `js/maquinas.js` (`_defaultCamUrl`).

> **`LD_LIBRARY_PATH` no es opcional en las K1.** Sin él falla con
> `dlopen: input_memfd.so: cannot open shared object file`, aunque el plugin
> exista en `/usr/lib/mjpg-streamer/`: el cargador no busca en esa carpeta. En
> las Ender-5 Max sí está en la ruta y por eso ahí no hace falta.
>
> **Los parámetros del plugin van dentro de las comillas.** `-i "input_memfd.so
> -t 0"` es un solo argumento. `ps` los muestra sin comillas y copiarlos tal
> cual da `invalid option -- 't'`.

### K2 y K2 Plus — go2rtc sobre WebRTC

Estas no publican MJPEG. La cámara sale por WebRTC y hay un puente de tres
piezas, instalado a mano en `/mnt/UDISK/helper-script/`:

1. `k2rtc.py` — expone el WebRTC de la impresora como endpoint local en `127.0.0.1:8090`
2. `go2rtc` — lo convierte a JPEG y lo sirve en el `1984`
3. `camera_watchdog.py` — lo mantiene vivo

Copiar solo go2rtc no sirve: sin `k2rtc.py` no hay nada que convertir.

```bash
K2=192.168.100.75
curl -s -m 5 -o /dev/null -w "%{http_code}\n" "http://$K2:1984/api/streams"
```

`000` = go2rtc caído. Se levanta así (`nohup` no existe en estas máquinas):

```bash
ssh root@$K2 'start-stop-daemon -S -b -x /usr/bin/python3 -- /mnt/UDISK/helper-script/k2rtc.py'
ssh root@$K2 'start-stop-daemon -S -b -x /mnt/UDISK/helper-script/go2rtc -- -config /mnt/UDISK/helper-script/go2rtc.yaml'
curl -s -m 20 -o /dev/null -w "%{http_code} %{content_type}\n" "http://$K2:1984/api/frame.jpeg?src=k2plus"
```

URL para el **📷** (el stream se llama `k2plus` en las tres, también en las K2):

```
http://192.168.100.75:1984/api/frame.jpeg?src=k2plus
```

> El primer cuadro tarda: hay que negociar WebRTC con la cámara. Dale hasta 20
> segundos antes de darlo por fallido.
>
> Si hay que instalar el puente en una K2 desde cero, se copia la carpeta
> completa desde una que funcione, y en el `go2rtc.yaml` hay que cambiar
> `candidates:` por la IP de la máquina de destino. **El binario es armv7l: no
> sirve en las K1, que son mips.**

### Arranque automático de las cámaras

Nada de esto sobrevive a un corte de luz por sí solo. El script va en
`/etc/init.d/` con prefijo `S99`; el `sleep` inicial le da tiempo a `cam_app` a
publicar antes de que el streamer intente leer.

K2 / K2 Plus: `S99camera` levanta las tres piezas (ya existe en las que
funcionan, se copia tal cual). K1: script propio, porque cambia el mecanismo y
la ruta de la partición de datos (`/usr/data`, no `/mnt/UDISK`):

```sh
#!/bin/sh
PLUGINS=/usr/lib/mjpg-streamer
start() {
    sleep 30
    LD_LIBRARY_PATH=$PLUGINS /usr/bin/mjpg_streamer -b \
      -i "input_memfd.so -t 0" \
      -o "output_http.so -w /usr/share/mjpg-streamer/www/ -p 8080"
}
stop() { killall mjpg_streamer 2>/dev/null; }
case "$1" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  *) echo "Usage: $0 {start|stop|restart}" ;;
esac
```

```bash
for ip in 126 7 68; do scp -O ~/Desktop/S99camera-k1 root@192.168.100.$ip:/etc/init.d/S99camera; ssh root@192.168.100.$ip 'chmod +x /etc/init.d/S99camera'; done
```

### El bridge solo deja pasar ciertos puertos

`7125, 8080, 4408, 4409, 80, 1984`. El `8080` y el `1984` están permitidos, así
que ambos esquemas funcionan en modo `🌐 Remoto` sin tocar nada. Una cámara en
otro puerto daría **403** en remoto aunque funcione en local; se agrega con la
variable `BRIDGE_PORTS` del bridge en el iMac.

---

## Caso 3 · La versión que muestra la pantalla no es la instalada

Ver [FIRMWARE_K1.md](FIRMWARE_K1.md), sección "La pantalla puede mentir". En
resumen: el número de la pantalla sale de un archivo editable en `/usr/data`
que el OTA no toca, y en la K1 #2 estaba alterado a mano.

Chequeo rápido de una máquina:

```bash
ssh root@192.168.100.X 'sh /etc/ota_bin/get_ota_current_version.sh; grep -o "\"sys_version\":\"[^\"]*\"" /usr/data/creality/userdata/config/system_version.json'
```

Si los dos números no coinciden, está alterado. Al 2026-08-12: las #2 (ya
corregida), #3 y #4 coinciden; la #1 no se pudo revisar.

---

## Trampas del entorno

Cosas que cuestan media hora la primera vez y treinta segundos la segunda.

| Síntoma | Causa |
|---|---|
| `scp: Connection closed` | macOS usa SFTP y el BusyBox de las impresoras no lo tiene. **Usa `scp -O`**, en ambas direcciones. |
| `ash: nohup: not found` | No existe en estas máquinas. Usa `start-stop-daemon -S -b -x <binario> -- <args>`. |
| `netstat: /proc/net/tcp6: No such file` | Ruido, no error. La salida de IPv4 sale igual. |
| `zsh: command not found: #` | zsh interactivo no acepta comentarios en línea, y además deja la variable **sin definir**. Pega los comandos sin comentarios. |
| La llave SSH se copia pero el login sigue fallando | Las Ender-5 Max traen **dropbear 2019.78**: no conoce ed25519 (llegó en 2020.79) y solo firma RSA con SHA-1, que OpenSSH ≥8.8 desactivó. Engaña porque `ssh-copy-id` dice "1 key added" y los permisos quedan 700/700/600. Se arregla en el **cliente**: `-o PubkeyAcceptedAlgorithms=+ssh-rsa`. |
| `zsh: unknown file attribute` al pegar comandos | zsh interactivo no trata `#` como comentario: `# 1 · copiar (70 MB)` se ejecuta y los paréntesis se leen como filtros de archivo. **Pega los bloques sin comentarios.** |
| Un `grep` de estado que nunca coincide | Moonraker devuelve el JSON con espacio: `"state": "standby"`. Usa `grep -o '"state": *"[a-z]*"'`. |
| Una impresora que aparece y desaparece del barrido | Las K1 están por WiFi y responden lento. Sube el timeout a 6-10 segundos. |
| El dashboard da por vivas máquinas apagadas | La sonda de vida tomaba por buena **cualquier respuesta &lt;500**, y al cambiar el error del bridge de 502 a 424 (Cloudflare se come los 5xx) sus propios errores entraron en ese rango. Ahora el bridge marca lo suyo con `X-Bridge-Error`. **Si tocas el código de error del bridge, mira quién lo interpreta.** |
| El comando de arranque no dice nada y el puerto sigue muerto | El modo daemon se traga los errores. Córrelo en primer plano redirigiendo a un archivo y léelo. |

---

## Pendientes

- **¿Por qué desapareció `moonraker.conf`?** Faltaba en dos de cuatro K1. No se
  borra solo. Las fechas apuntan al 23 de junio, el mismo día que apareció el
  `downgrade.sh` en la #2 y se editó su `system_version.json`. Si fue un
  procedimiento manual, va a repetirse.
- **`printer.cfg` crece solo.** En la #4 pasó de 8,8 KB a 24 KB en cinco días,
  con un respaldo nuevo en cada cambio. A ese ritmo termina siendo un problema.
- **La K1 #4 (`.68`) y la Ender-5 Max #9 (`.66`) ya recibieron el injerto**
  el 2026-08-19 (ver Caso 1d). Ambas siguen sin nginx/Fluidd ni cámara; lo
  de fondo es reflashear.
- **Cuatro máquinas no aparecen en la red** (2026-08-19): K1 #1 `.51`, K2 Plus
  #11 `.75`, Ender-5 Max #10 `.162` y la Giga `.44`. Todas dan `EHOSTDOWN`:
  no están encendidas o no están en esta red — no es telemetría.
- **Reservas DHCP fijas** para las once máquinas. Media hora perdida el
  2026-08-11 buscando cuál impresora era cuál, y una IP documentada que no
  existía en el parque.
- **La K2 #12 se quedó sin imagen con el modal abierto** y se recuperó sola.
  Posible causa: el WebRTC de la impresora admite un consumidor a la vez y la
  tarjeta y el modal se lo disputan. Sin confirmar.
