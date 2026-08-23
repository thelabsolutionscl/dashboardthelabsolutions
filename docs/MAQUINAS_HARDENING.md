# Hardening integral de MÁQUINAS

Este upgrade convierte los hallazgos de la auditoría en controles verificables.

## Objetivos

- credenciales permanentes fuera del HTML/navegador;
- sesiones cortas por rol;
- una sola cola operacional central;
- lifecycle y producción central aun sin dashboard abierto;
- durabilidad verificable y cuotas de cola;
- seguridad desatendida alimentada directamente desde el controller;
- verificación real de cámaras;
- continuidad de health tras reinicios;
- disponibilidad, MTBF y MTTR históricos;
- identidad de host/MCU/CAN separada de config drift;
- controller escuchando sólo en loopback por defecto;
- pruebas de regresión, seguridad y fallos.

## Componentes

- `farm-auth-preload.js`: valida sesiones HMAC cortas y traduce roles a credenciales locales.
- `farm-bind-preload.js`: limita el listener 8347 a `127.0.0.1`.
- `machineops-farm-queue-adapter.js`: enlaza trabajos MachineOps con `farmJobId`.
- `farm-queue-guard-preload.js`: cuotas/disco y confirmación de persistencia antes del 201.
- `farm-lifecycle-preload.js`: detecta fin/cancelación/falla y registra producción server-side.
- `farm-safety-agent-preload.js`: sensores/cámara desde el host del controller.
- `farm-identity-preload.js`: fingerprints de host/MCU/CAN.
- `farm-health-preload.js` + `farm-reliability-preload.js`: continuidad y métricas históricas.
- `printer-access-worker`: emite sesiones tras Cloudflare Access.

## Despliegue seguro

El cambio se despliega primero con compatibilidad de tokens largos para rollback. El dashboard deja de publicar `PRINTER_TUNNEL_TOKEN`; después de confirmar sesiones cortas se rotan las credenciales permanentes.

El movimiento físico del controller/cloudflared a un host dedicado con Ethernet + UPS es una etapa operacional posterior: el software queda compatible mediante el servicio systemd incluido.
