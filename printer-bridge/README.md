# Printer Bridge seguro — The Lab Solutions

Conecta el dashboard con Moonraker/Klipper y cámaras del taller sin publicar un
token maestro en el navegador.

```text
Dashboard ─HTTPS + Cloudflare Access─▶ printers.thelab.solutions
                                      │
                                      ▼
                               secure-launcher.js
                               127.0.0.1:8347
                                      │ identidad + rol
                                      │ allowlist IP/puerto/ruta
                                      ▼
                                  server.js
                               127.0.0.1:8348
                                      │
                                      ▼
                              impresoras permitidas
```

## Cambios de seguridad

- El servicio público escucha solo en `127.0.0.1`; Cloudflare Tunnel es la única
  entrada remota.
- La identidad remota viene de **Cloudflare Access**.
- Los usuarios se dividen en `reader`, `writer` y `admin`.
- Solo se aceptan IPs declaradas en `printers.json`.
- Las cámaras aceptan únicamente GET/HEAD.
- Pausar, reanudar, iniciar y subir archivos requieren `writer` o `admin`.
- G-code, reinicios, apagado, borrado y mantenimiento requieren `admin`.
- El token interno entre ambos procesos nunca sale del iMac.
- `?bt=TOKEN` se elimina antes de reenviar; no se usa como autenticación.
- Cada operación genera un log JSON con usuario, rol, recurso, resultado y duración.

## Requisitos

- macOS con Node.js 18 o superior.
- Cloudflare Tunnel para `printers.thelab.solutions`.
- Una aplicación Cloudflare Access cubriendo **todo el hostname**.
- Moonraker accesible desde el iMac por la red local.

## 1. Configurar la allowlist de impresoras

```bash
cd ~/dashboardthelabsolutions/printer-bridge
cp printers.example.json printers.json
nano printers.json
```

Ejemplo:

```json
{
  "printers": [
    { "name": "K1 1", "ip": "192.168.100.51" },
    { "name": "K2 1", "ip": "192.168.100.71" }
  ]
}
```

`printers.json` está ignorado por Git y debe contener únicamente las IP reales.
El proceso no arranca si la allowlist está vacía.

También se puede usar temporalmente:

```bash
export BRIDGE_PRINTERS="192.168.100.51,192.168.100.71"
```

## 2. Configurar roles

Antes de instalar:

```bash
export BRIDGE_ADMIN_EMAILS="gustavo@thelab.solutions"
export BRIDGE_WRITE_EMAILS="nicanor@thelab.solutions,produccion@thelab.solutions"
export BRIDGE_ALLOW_ORIGINS="https://dashboard.thelab.solutions"
```

- `reader`: telemetría, archivos, cámaras y estado.
- `writer`: además inicio/pausa/reanudación/cancelación y upload.
- `admin`: además G-code, reinicios, borrados y mantenimiento.

Quien entra por Access y no aparece en las listas queda como `reader`.

## 3. Instalar o actualizar

```bash
cd ~/dashboardthelabsolutions

git pull
cd printer-bridge
./install-launchd.sh
```

El instalador:

1. Verifica Node y la sintaxis de ambos procesos.
2. Exige la allowlist de impresoras.
3. Instala `secure-launcher.js` como LaunchAgent.
4. Inicia `server.js` en un puerto interno con token aleatorio.
5. Comprueba `/healthz`.

Logs:

```bash
tail -f /tmp/printer-bridge.log /tmp/printer-bridge.err
```

## 4. Cloudflare Tunnel

La configuración debe apuntar al gateway seguro:

```yaml
tunnel: printers
credentials-file: /Users/TU_USUARIO/.cloudflared/<ID>.json
ingress:
  - hostname: printers.thelab.solutions
    service: http://127.0.0.1:8347
  - service: http_status:404
```

Instalarlo como servicio:

```bash
sudo cloudflared service install
```

No publicar el puerto 8347 en el router y no cambiar `BRIDGE_HOST=127.0.0.1`.

## 5. Cloudflare Access obligatorio

En Cloudflare Zero Trust:

1. **Access → Applications → Add an application → Self-hosted**.
2. Dominio: `printers.thelab.solutions`.
3. Proteger `/*`, no una ruta parcial.
4. Política Allow solo para usuarios autorizados de The Lab.
5. Activar duración de sesión corta, por ejemplo 8 horas.
6. Probar en ventana incógnita: sin iniciar sesión, `/healthz` puede estar visible,
   pero cualquier ruta de impresora debe quedar bloqueada por Access.

Cloudflare agrega `Cf-Access-Authenticated-User-Email`; el gateway lo convierte
en rol. El navegador ya no necesita conocer un token del bridge.

## 6. Pruebas locales

El gateway genera dos tokens locales con permisos `0600`:

- `.bridge-read-token`
- `.bridge-admin-token`

Sirven para diagnóstico desde el iMac, no para pegarlos en el HTML.

```bash
READ=$(cat .bridge-read-token)
ADMIN=$(cat .bridge-admin-token)

curl -H "X-Bridge-Read-Token: $READ" \
  http://127.0.0.1:8347/192.168.100.51/printer/info

curl -X POST -H "X-Bridge-Admin-Token: $ADMIN" \
  http://127.0.0.1:8347/restart
```

## 7. Dashboard

El dashboard debe usar `https://printers.thelab.solutions` y enviar peticiones
con credenciales de navegador. La primera vez, abre el hostname en una pestaña
e inicia sesión en Cloudflare Access.

El antiguo `X-Bridge-Token` queda deshabilitado. Existe una compatibilidad de
migración, apagada por defecto:

```bash
BRIDGE_ALLOW_LEGACY_TOKEN=true
```

No mantenerla activa en producción.

## WebSocket y cámaras

- WebSocket: `wss://printers.thelab.solutions/IP/websocket`.
- Cámara: `https://printers.thelab.solutions/IP:PUERTO/ruta`.
- Cloudflare Access autentica estas solicitudes mediante su cookie de sesión.
- El gateway elimina cualquier `bt` antiguo de la URL antes de reenviar.

## Moonraker

No usar CORS `*`. Restringirlo a los orígenes realmente utilizados y mantener
el iMac dentro de `trusted_clients`:

```ini
[authorization]
cors_domains:
  https://dashboard.thelab.solutions
trusted_clients:
  127.0.0.1
  192.168.100.0/24
```

El gateway ya no falsifica `X-Forwarded-For: 127.0.0.1`; Moonraker ve la conexión
real desde el iMac.

## Variables

| Variable | Predeterminado | Uso |
|---|---|---|
| `BRIDGE_HOST` | `127.0.0.1` | Dirección local del gateway |
| `BRIDGE_PORT` | `8347` | Puerto del gateway |
| `BRIDGE_INTERNAL_PORT` | `8348` | Puerto privado de `server.js` |
| `BRIDGE_PRINTERS` | vacío | IPs exactas, alternativa a `printers.json` |
| `BRIDGE_PORTS` | `7125,8080,4408,4409,80,1984` | Puertos permitidos |
| `BRIDGE_ALLOW_ORIGINS` | dashboard oficial | CORS exacto |
| `BRIDGE_ADMIN_EMAILS` | vacío | Usuarios administrativos |
| `BRIDGE_WRITE_EMAILS` | vacío | Usuarios de producción |
| `BRIDGE_READ_TOKEN` | generado | Diagnóstico local de lectura |
| `BRIDGE_ADMIN_TOKEN` | generado | Diagnóstico local administrativo |
| `BRIDGE_ALLOW_LEGACY_TOKEN` | `false` | Migración temporal, no recomendado |
| `BRIDGE_MAX_BODY_BYTES` | `134217728` | Límite de upload |

## Rotación y respuesta a incidentes

Ante una sospecha:

1. Revocar sesiones en Cloudflare Access.
2. Revisar `/tmp/printer-bridge.log` buscando `bridgeAudit`.
3. Borrar `.bridge-read-token` y `.bridge-admin-token`.
4. Reiniciar el LaunchAgent; se generan tokens nuevos.
5. Revisar que `printers.json` solo contenga IPs autorizadas.
6. Mantener `BRIDGE_ALLOW_LEGACY_TOKEN=false`.
