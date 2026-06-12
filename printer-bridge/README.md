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

### Autoarranque (launchd)

1. Edita `com.thelab.printer-bridge.plist`: ajusta la ruta de `node` (`which node`) y la de `server.js`.
2. Instálalo:

```bash
cp com.thelab.printer-bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.thelab.printer-bridge.plist
```

El bridge ahora arranca solo al encender el iMac y se reinicia si se cae.
Logs en `/tmp/printer-bridge.log`.

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

Corre el túnel (y déjalo como servicio):

```bash
cloudflared tunnel run printers                # probar
sudo cloudflared service install               # instalar como servicio permanente
```

Verifica desde cualquier red:

```bash
curl https://printers.thelab.solutions/healthz
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
3. Guardar. En la sección **Máquinas**, con el botón en `🌐 Remoto`, las impresoras
   encendidas deben pasar de "Offline" a su estado real en ~15 segundos.

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

Puertos permitidos por el bridge: `7125, 8080, 4408, 4409, 80`
(configurable con la variable de entorno `BRIDGE_PORTS`).

---

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
| `BRIDGE_PORTS` | `7125,8080,4408,4409,80` | Puertos de destino permitidos |
| `BRIDGE_ALLOW_ORIGIN` | `*` | Origen CORS (puedes restringirlo a la URL del dashboard) |
