# Migración del Farm Controller a host dedicado

El software soporta macOS/launchd y Linux/systemd. Para eliminar el iMac como punto único de falla, el objetivo recomendado es un mini-PC o equipo dedicado por Ethernet y UPS.

## Requisitos

- Linux estable con Node.js 22 o compatible.
- Ethernet a la misma LAN de las impresoras.
- UPS para host, switch/router y, si corresponde, equipos críticos.
- `cloudflared` en el mismo host.
- usuario de servicio `thelab-farm` sin login interactivo.
- `/var/lib/thelab-farm` respaldado regularmente.

## Instalación de referencia

```bash
sudo useradd --system --home /var/lib/thelab-farm --shell /usr/sbin/nologin thelab-farm
sudo mkdir -p /opt/thelab /var/lib/thelab-farm
sudo chown -R thelab-farm:thelab-farm /var/lib/thelab-farm
```

Instalar el repositorio en `/opt/thelab/dashboardthelabsolutions` y copiar:

`printer-bridge/farm-controller.service` → `/etc/systemd/system/thelab-farm.service`

Luego:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now thelab-farm
curl -s http://127.0.0.1:8347/healthz
```

El controller escucha sólo en `127.0.0.1`. Configurar Cloudflare Tunnel para apuntar a `http://127.0.0.1:8347`.

## Datos que se deben migrar

Copiar de forma consistente y con el servicio detenido: `registry.json`, `queue.json`, `production.json`, `health.json`, `drift.json`, `identity.json`, `safety.json`, `lifecycle.json` y `session-secret`.

No copiar credenciales dentro del repositorio. Los tokens/variables deben ir en `/etc/thelab-farm.env` con permisos `0600`.

## Corte

1. detener nuevos encolados;
2. esperar que no existan estados `checking/uploading`;
3. detener Farm Controller en el iMac;
4. copiar datos;
5. iniciar el host Linux;
6. confirmar `/healthz`, `/farm/health`, registry y una impresora de prueba;
7. cambiar el servicio del Cloudflare Tunnel al nuevo host;
8. mantener el iMac apagado como controller, pero disponible temporalmente para rollback.

Nunca ejecutar dos Farm Controllers activos contra la misma flota/cola durante el corte.
