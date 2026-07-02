# 🖨 Printer Bridge — The Lab Solutions

Conecta las impresoras 3D del taller (Moonraker/Klipper, las mismas que usa
OrcaSlicer) con el dashboard, **desde el taller y desde fuera**.

```
                    ┌──────────────────────── TALLER ────────────────────────┐
Dashboard (HTTPS)   │  iMac                          Impresoras              │
GitHub Pages ──────▶│  cloudflared ──▶ bridge ──────▶ 192.168.100.x:7125     │
  desde cualquier   │  (túnel)         :8347   HTTP   (Moonraker)            │
  lugar             │                                 :8080 (webcams)        │
                    └─────────────────────────────────────────────────────────┘
```

El dashboard tiene **dos modos** (botón `📡 Local / 🌐 Remoto` en la sección Máquinas):

| Modo | Cómo conecta | Cuándo usarlo |
|------|--------------|---------------|
| 📡 Local | Directo a `http://IP:7125` | Solo dentro de la red del taller |
| 🌐 Remoto | Vía túnel → bridge → impresora | Desde cualquier lugar (también funciona en el taller) |

---

## Requisitos

- **Node.js ≥ 18** en el iMac → `brew install node` (o desde nodejs.org)
- Cuenta **Cloudflare** con el dominio `thelab.solutions` (para el túnel con URL fija)
- Impresoras con **Moonraker activo** (las que ya funcionan con OrcaSlicer ya lo tienen)

---

## Paso 1 — Correr el bridge en el iMac

```bash
cd ~/  # o donde prefieras
git clone https://github.com/thelabsolutionscl/dashboardthelabsolutions.git
cd dashboardthelabsolutions/printer-bridge
node server.js
```

Al arrancar imprime el **token** (se genera una vez y queda en `.bridge-token`):

```
──────────────────────────────────────────
  The Lab Solutions — Printer Bridge
  Escuchando en  : http://0.0.0.0:8347
  Token          : Kx9...Qz2
──────────────────────────────────────────
```

Guarda ese token — lo pegarás en el dashboard en el Paso 3.

Prueba que funciona (desde el mismo iMac, reemplaza `TOKEN` y la IP de una impresora encendida):

```bash
curl 'http://localhost:8347/healthz'
curl 'http://localhost:8347/192.168.100.51/printer/info?bt=TOKEN'
```

### Autoarranque (launchd) — un solo comando

```bash
cd ~/dashboardthelabsolutions/printer-bridge
./install-launchd.sh
```

El script detecta solo la ruta de `node` y de `server.js`, genera el LaunchAgent
en `~/Library/LaunchAgents/`, lo carga, verifica que `/healthz` responde y te
muestra el **token** para pegarlo en el dashboard. Es **idempotente**: vuelve a
correrlo cuando quieras (p. ej. tras actualizar Node con nvm, que cambia su ruta)
y se reconfigura solo.

El bridge ahora arranca al encender el iMac y se reinicia si se cae.
Logs en `/tmp/printer-bridge.log` y `/tmp/printer-bridge.err`.

```bash
# estado / reiniciar / quitar autoarranque
launchctl list | grep printer-bridge
launchctl unload ~/Library/LaunchAgents/com.thelab.printer-bridge.plist && \
  launchctl load -w ~/Library/LaunchAgents/com.thelab.printer-bridge.plist
./install-launchd.sh --uninstall
```

> Edición manual del `.plist` (alternativa): ajusta a mano `node`, `server.js` y
> `WorkingDirectory`, cópialo a `~/Library/LaunchAgents/` y haz `launchctl load -w`.

---

## Paso 2 — Túnel Cloudflare (acceso remoto)

En el iMac:

```bash
brew install cloudflared
cloudflared tunnel login                       # abre el navegador, autoriza thelab.solutions
cloudflared tunnel create printers
cloudflared tunnel route dns printers printers.thelab.solutions
```

Crea `~/.cloudflared/config.yml`:

```yaml
tunnel: printers
credentials-file: /Users/TU_USUARIO/.cloudflared/<ID-DEL-TUNEL>.json
ingress:
  - hostname: printers.thelab.solutions
    service: http://localhost:8347
  - service: http_status:404
```

Corre el túnel (y déjalo como **servicio que arranca solo** al encender el iMac,
igual que el bridge):

```bash
cloudflared tunnel run printers                # probar a mano (Ctrl-C para parar)
sudo cloudflared service install               # instalar como servicio permanente
```

> Importante: instala el túnel **como servicio** (`service install`). Si no, al
> reiniciar el iMac el bridge volverá (launchd) pero el túnel no, y el modo
> 🌐 Remoto quedará caído. Con el servicio, ambos sobreviven al reinicio.

Verifica que está activo y que sobrevive reinicios:

```bash
curl https://printers.thelab.solutions/healthz   # desde cualquier red → {"ok":true,...}
sudo launchctl list | grep cloudflared           # el servicio del túnel
launchctl list | grep printer-bridge             # el bridge
```

> **Alternativa rápida sin dominio:** `cloudflared tunnel --url http://localhost:8347`
> te da una URL `https://xxxx.trycloudflare.com` al instante, pero **cambia en cada
> reinicio** — tendrías que actualizarla en el dashboard cada vez. Útil solo para probar.

---

## Paso 3 — Configurar el dashboard

1. Abre el dashboard → chip de usuario (arriba a la derecha) → **Mi cuenta**
2. En **Túnel Impresoras**:
   - URL: déjala vacía (usa el default `https://printers.thelab.solutions`) o pega tu URL
   - **Token del bridge**: pega el token del Paso 1
   - Pulsa **Guardar**.
3. Pulsa **Probar**: te dice al instante si el túnel responde y si el token es válido
   (✅ / ✗). Si algo falla, el mensaje indica qué arreglar. El botón **Reiniciar bridge**
   lo reinicia en remoto sin tocar el iMac (launchd lo levanta de nuevo).
4. En la sección **Máquinas**, con el botón en `🌐 Remoto`, las impresoras
   encendidas deben pasar de "Offline" a su estado real en ~15 segundos.

> El token y la URL se guardan **por equipo** (en el navegador). Repite el Paso 3
> en cada dispositivo desde el que uses el dashboard (iMac, MacBook, etc.).

---

## Paso 4 — Moonraker en cada impresora (CORS)

Para el **modo local** (dashboard → impresora directo) Moonraker debe aceptar
peticiones del dashboard. En cada impresora edita
`~/printer_data/config/moonraker.conf` (vía SSH, Fluidd o Mainsail):

```ini
[authorization]
cors_domains:
  *
trusted_clients:
  127.0.0.1
  192.168.100.0/24
```

Y reinicia Moonraker (`sudo systemctl restart moonraker` o desde la UI).

> Para el **modo remoto** esto no es necesario: el bridge habla con Moonraker
> desde la misma red (cliente confiable) y maneja CORS por su cuenta.

### Notas por modelo

| Modelo | Moonraker |
|--------|-----------|
| Creality K1 / K2 / K2 Plus / Ender-5 Max | Ya activo si OrcaSlicer les imprime (modo root habilitado). Puerto 7125. |
| Elegoo OrangeStorm Giga | Klipper de fábrica — Moonraker en puerto 7125, Fluidd en el 80. En OrcaSlicer: Host type `Moonraker`, host `192.168.100.44:7125`. |

---

## Modo local en el taller (sin túnel)

El dashboard corre en HTTPS (GitHub Pages) y los navegadores bloquean por defecto
las conexiones HTTP hacia la red local ("mixed content"). Para usar `📡 Local`:

**Chrome** (una vez por equipo): candado 🔒 junto a la URL → *Configuración de sitios*
→ *Contenido no seguro* → **Permitir** → recargar.

Si no quieres tocar esa configuración, usa `🌐 Remoto` también dentro del taller —
funciona igual, solo que el tráfico da la vuelta por Cloudflare.

---

## Webcams

En cada tarjeta de impresora → botón 📷 → pega la URL del stream MJPEG local, p. ej.:

```
http://192.168.100.51:8080/?action=stream
```

- En **modo local** el dashboard la usa tal cual.
- En **modo remoto** la reescribe automáticamente a través del túnel
  (`https://printers.thelab.solutions/192.168.100.51:8080/?action=stream&bt=...`).

Puertos permitidos por el bridge: `7125, 8080, 4408, 4409, 80, 1984`
(configurable con la variable de entorno `BRIDGE_PORTS`). El `1984` es go2rtc,
usado por las cámaras de las K2/K2 Plus (el dashboard consume su `/api/frame.jpeg`).

---

## Tiempo real (WebSocket)

El dashboard ahora abre un **WebSocket** a Moonraker (`/websocket`) por cada
impresora y recibe el estado **empujado en vivo** (lo mismo que hacen Fluidd y
Mainsail), en vez de sondear cada pocos segundos. Esto elimina el parpadeo y
las ráfagas de polling.

- En **modo remoto** el bridge hace de proxy del WebSocket
  (`wss://printers.thelab.solutions/{IP}/websocket?bt=TOKEN`). Solo necesitas
  **actualizar el bridge** en el iMac (`git pull` y reiniciarlo / `launchctl`)
  para que tenga el soporte WS; mientras tanto el dashboard cae de vuelta al
  polling automáticamente, así que nada se rompe.
- En **modo local** conecta directo (`ws://IP:7125/websocket`).
- Si el WebSocket se cae, el dashboard **reintenta con backoff** y sigue
  sondeando de respaldo. Para desactivarlo del todo (volver a solo-polling):
  en la consola del navegador `localStorage.setItem('printer_ws_enabled','0')`.

## Seguridad

- El bridge **exige token** en cada petición (header `X-Bridge-Token` o `?bt=`).
- Solo hace proxy hacia **IPs privadas** (RFC 1918) y **puertos permitidos** — nunca a internet.
- El token vive en `.bridge-token` (no se sube a git) y en el `localStorage` del navegador.
- Si el token se filtra: borra `.bridge-token`, reinicia el bridge (genera uno nuevo) y actualiza el dashboard.

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `BRIDGE_PORT` | `8347` | Puerto donde escucha el bridge |
| `BRIDGE_TOKEN` | (autogenerado) | Token fijo, si prefieres definirlo tú |
| `BRIDGE_PORTS` | `7125,8080,4408,4409,80,1984` | Puertos de destino permitidos (1984 = go2rtc cámaras K2) |
| `BRIDGE_ALLOW_ORIGIN` | `*` | Origen CORS (puedes restringirlo a la URL del dashboard) |

---

## 🤖 Auditoría y mantención automática (9 AM)

El bridge puede **auditar, reiniciar el firmware y calibrar** todas las
impresoras cada mañana (por defecto a las **9:00**), para que al llegar a las
10:00 estén listas para imprimir. Corre en el iMac (acceso LAN directo), sin
depender del navegador ni del túnel. Las impresoras se procesan **en
paralelo**: el parque completo termina en lo que tarda la más lenta
(típicamente 5–15 min, muy dentro de la ventana 9→10).

**Activarlo:**

```bash
cd printer-bridge
cp maint-config.example.json maint-config.json
# edita maint-config.json: pon las IPs reales de tus impresoras y, si quieres,
# Airtable (para ver el reporte en el dashboard) y el email de aviso.
```

Reinicia el bridge (`./install-launchd.sh` o `node server.js`). En el arranque
verás algo como:

```
  Mantención auto: 09:00 America/Santiago · 5 impresora(s) · calibrar=true · reinicioPreventivo=true · dryRun=true
```

**Importante — empieza en `dryRun: true`.** En ese modo NO manda ningún comando
físico (no calienta ni mueve nada): solo audita (incluida la consola) y te
envía el reporte. Cuando veas que el reporte de la mañana se ve bien, edita
`maint-config.json` y pon `"dryRun": false` para que actúe de verdad. El
cambio se toma sin reiniciar el bridge.

**Qué hace cada mañana, por impresora** (solo si está **libre** — nunca toca una
imprimiendo, pausada, ni ejecutando G-code/macros, detectado vía `idle_timeout`):
1. **Audita** estado (Klipper, home, malla de cama, temps) y **revisa la
   consola** (`/server/gcode_store`): si hay errores `!!` de las últimas 24 h
   —los mismos que verías en Fluidd/Mainsail— los incluye en el reporte.
2. **Reinicia el firmware** (`FIRMWARE_RESTART`): a **todas** las libres si
   `restartAll: true` (chequeo preventivo diario), o solo a las que estén en
   error si `restartAll: false`. Espera a que Klipper vuelva a `ready` antes de
   seguir; si reincide en error, avisa "revisar hardware" y no la calibra.
3. Si `calibrate: true` → `G28` + `BED_MESH_CALIBRATE`, y deja la máquina
   segura (calentadores a 0 + motores liberados). Puedes excluir una impresora
   puntual con `"calibrate": false` en su entrada, y subir el tiempo máximo por
   máquina con `calibrateTimeoutMs` (default 4 min; útil para camas gigantes).
4. **Reporta** a Airtable (`Maquinas_Auditoria`, visible en el dashboard →
   Máquinas) y por email.

**Probar sin esperar a las 9 AM** (token del bridge):

```bash
curl -X POST "http://localhost:8347/maint/run?bt=TU_TOKEN"
curl "http://localhost:8347/maint/status?bt=TU_TOKEN"
```

Solo puede haber **una corrida a la vez**: si lanzas `/maint/run` mientras otra
corrida (manual o la de las 9:00) sigue en curso, responde `409` y no toca nada.

> Seguridad: la calibración calienta y mueve la máquina sin nadie presente.
> Por eso arranca en dry-run y solo opera impresoras libres. Revisa el primer
> par de reportes antes de desactivar el dry-run.
>
> Requisitos para que corra a las 9:00: el **iMac debe estar encendido** (o
> configurado para despertarse antes — Ajustes → Energía / `pmset repeat wake`)
> y las **impresoras enchufadas y encendidas**. Una impresora apagada sale en
> el reporte como OFFLINE y se salta — el bridge no puede encenderla remoto.
