# Auditoría de confiabilidad — Máquinas

Fecha: 2026-09-18

## Objetivo

Que la sección **Máquinas** mantenga telemetría reciente, no parpadee ni pierda
estado al navegar por el dashboard y conserve las cámaras conectadas/reintentando
sin intervención manual.

## Hallazgos críticos

### 1. El dashboard apagaba el monitor al salir de Máquinas

`switchTab()` detenía el intervalo de polling y cerraba todos los WebSockets al
abrir cualquier otra sección. Al volver a Máquinas había que reconstruir las
conexiones desde cero, lo que producía ventanas de estado antiguo y reconexiones
visibles.

**Corrección:** el servicio realtime permanece activo durante la sesión una vez
que Máquinas se inicializa.

### 2. Un WebSocket medio abierto podía congelar una impresora

El polling se omitía con solo ver `_wsConnected=true`. No existía heartbeat ni
edad máxima del último mensaje. Una conexión TCP rota sin evento `close` podía
dejar el último estado mostrado indefinidamente.

**Corrección:** heartbeat cada 15 s, timeout de apertura, edad máxima de 45 s y
polling de respaldo cuando el WebSocket deja de ser fresco.

### 3. En remoto se desactivaba WebSocket por defecto

Aunque el bridge actual soporta `wss://.../{IP}/websocket`, el dashboard usaba
solo polling en modo remoto.

**Corrección:** con token válido el modo remoto usa WebSocket y conserva polling
como red de seguridad.

### 4. Ocultar la pestaña pausaba explícitamente varias capas

El monitor, el registry/queue y FarmHealth contenían guards por
`document.hidden`. Los navegadores ya pueden limitar timers por su cuenta; la
aplicación además los detenía explícitamente.

**Corrección:** se eliminan esas pausas explícitas y, al recuperar foco,
visibilidad o conectividad, se fuerza una resincronización inmediata.

### 5. Reordenar tarjetas destruía todas las cámaras

Cuando cambiaba el orden de máquinas por estado/ETA, el grid se reconstruía con
`innerHTML`. Cada reconstrucción cerraba y volvía a abrir los streams.

**Corrección:** las tarjetas existentes se mueven con `appendChild`; cuando una
tarjeta sí necesita reconstruirse, se trasplanta su nodo de cámara al nuevo DOM.

### 6. Los filtros desmontaban las cámaras

Filtrar por K1/K2/Ender eliminaba del DOM las tarjetas no visibles.

**Corrección:** todas las tarjetas permanecen montadas y el filtro solo cambia
su visibilidad. Los streams no pierden la conexión por cambiar de filtro.

### 7. Una caída de Moonraker también escondía la cámara

La cámara se eliminaba si la telemetría estaba `offline` o `shutdown`, pese a
que cámara y Moonraker son servicios independientes.

**Corrección:** mientras exista una IP válida, la cámara sigue intentando
conectarse incluso si la telemetría falla.

### 8. Los snapshots K2 se reemplazaban cada segundo aunque el frame anterior no llegara

go2rtc puede tardar varios segundos en negociar WebRTC. Reasignar `src` por
intervalo podía abortar una petición antes de terminar.

**Corrección:** el siguiente frame se solicita solo después de `load`; hay
timeout de 25 s y backoff de reintento hasta 30 s. MJPEG también se autoreintenta
tras `error`.

### 9. Inicializaciones simultáneas podían competir

Abrir Máquinas repetidamente mientras todavía cargaba Airtable podía lanzar más
de una inicialización.

**Corrección:** las aperturas concurrentes comparten una sola promesa de
inicialización.

## Arquitectura resultante

1. **WebSocket Moonraker**: canal primario en vivo, local y remoto.
2. **Polling HTTP**: respaldo cada 15 s cuando el WebSocket no está fresco.
3. **Farm Controller / FarmHealth**: observabilidad central en el iMac,
   independiente de la pantalla actualmente abierta.
4. **Cámaras**: nodos persistentes, carga eager, retry automático y snapshots
   secuenciales.
5. **Reanudación**: foco, volver a la pestaña y evento `online` fuerzan
   resincronización.

## Requisitos físicos para disponibilidad real 24/7

El software puede auto-recuperarse cuando vuelve la conectividad, pero ningún
dashboard puede mantener una imagen si la cámara, impresora, Wi‑Fi, iMac o túnel
están físicamente apagados. Para acercarse a disponibilidad permanente:

- el **printer-bridge** del iMac debe correr con launchd;
- el túnel **cloudflared** debe estar instalado como servicio;
- K1/Ender deben tener `mjpg_streamer` con arranque automático
  (`/etc/init.d/S99camera`);
- K2/K2 Plus deben mantener `k2rtc.py + go2rtc + camera_watchdog.py` y su
  `S99camera`;
- las impresoras deben tener IP/identidad vigente en Farm Registry;
- el bridge debe conservar acceso SSH para recuperación de servicios;
- router, iMac e impresoras necesitan alimentación y Wi‑Fi estables.

Con esos requisitos cumplidos, una caída transitoria de red o stream ya no
requiere recargar el dashboard: las capas cliente se reconectan solas al
recuperarse la infraestructura.
