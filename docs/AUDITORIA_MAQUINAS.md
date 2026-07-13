# Auditoría — Sección Máquinas (impresoras 3D)

Fecha: 2026-06-24 · Rama: `claude/machines-section-audit-ot1hhl`

Auditoría exhaustiva del monitor de impresoras, el control Moonraker/Klipper, el
WebSocket en vivo, la persistencia (Airtable/localStorage), la mantención, la
analítica, el slicer nativo `SL3D` y el `printer-bridge`.

**Arquitectura:** Dashboard → (remoto) túnel Cloudflare → `printer-bridge` (iMac
del taller) → Moonraker/Klipper de 14 impresoras; o (local) IP directa. Estado en
vivo por WebSocket con polling de respaldo cada 20 s.

Leyenda de estado: ✅ corregido en esta rama · 📋 recomendado (no aplicado, ver motivo).

---

## 1. Bugs corregidos

### Monitor / comunicación

| # | Severidad | Problema | Fix |
|---|-----------|----------|-----|
| 1 | 🔴 Alto | **La IP editada se revertía** al recargar en las 13 impresoras con IP fija en código (`loadMaquinasAirtable` forzaba el IP hardcodeado sobre Airtable y localStorage). Imposible corregir un cambio de DHCP desde la UI. | Flag de *override* `printer_ip_ovr_<id>`: si el usuario edita la IP a mano (tarjeta, gestor o modal de conexión), su valor manda; si no, el código sigue corrigiendo las no editadas. |
| 2 | 🟠 Medio-Alto | **Se perdía el registro de impresiones** que terminaban tras un corte de red: al recuperarse como `complete`/`standby` con `prev='offline'`, la sesión no se guardaba en historial/odómetro/analítica y quedaba colgada. | `checkTransitions` ahora cierra la sesión también al recuperarse de `offline`/`shutdown` con una sesión abierta. |
| 5 | 🟡 Medio | **El WebSocket en vivo no se reconectaba** al volver a la pestaña (el reintento se cancela con `document.hidden` y nada lo revivía → caías a polling de 20 s en silencio). | Nuevo listener `visibilitychange` que reconecta solo los sockets caídos y fuerza un sondeo inmediato. |
| 6 | 🟡 Medio | **Progreso atascado en 0%** en K2/K2 Plus (firmware Creality que reporta el avance por `display_status` y deja `virtual_sdcard.progress` en 0). | `_deriveStatus` usa `display_status.progress` como respaldo. |
| 16 | 🟢 Bajo | La alerta de inactividad nunca disparaba para una máquina ociosa desde el arranque (el reloj solo se sembraba al imprimir). | Se siembra el reloj la primera vez que se ve `standby`/`complete`; se excluye `offline`/`noip`/`shutdown`. |
| 12 | 🟢 Bajo | La parada de emergencia hacía `fetch` sin timeout (promesa colgada si el túnel cuelga). | `AbortSignal.timeout(8000)`. |

### Slicer SL3D

| # | Severidad | Problema | Fix |
|---|-----------|----------|-----|
| S1 | 🔴 Crítico | **"Enviar a todas las libres" mandaba todo a UNA impresora.** `enviar()` no recibía parámetros y siempre leía `slTarget`; `enviarATodas()` pasaba un `id` que se ignoraba y sincronizaba un `<select>` inexistente (`slSendTo`). El toast mentía. | `enviar(forceId)` usa el id explícito en todo el cuerpo; `enviarATodas` reparte de verdad. |
| S2 | 🔴 Crítico | **Inicio de impresión sin verificar máquina ocupada** en la rama "iniciar al subir", `startUploadedPrint` y el botón del modal de subida (podía pisar un trabajo en curso). | Guard `_isPrinterBusy` antes de cualquier `print/start` automático (consistente con `encolar`/`enviarCal`). |
| S3 | 🔴 Crítico | **Colisión de nombres de archivo** (`pieza_PLA_0.2mm.gcode`): re-laminar o dos piezas similares sobrescribían el mismo `.gcode`, y la cola podía arrancar el archivo equivocado. | Nombre con sello de tiempo `_YYYYMMDD-HHMMSS`, fijado una vez por laminado (`S.fname`) para que subida/cola/descarga/calibración usen el mismo. |
| S4 | 🟠 Alto | **`M104 S{nozzle}` calentaba la boquilla ANTES del `G28`** (secuencia por defecto y header de calibración) → *ooze* durante el homing y probing/ABL impreciso. | Orden seguro: cama + boquilla a temp de *probe* (≤150°) → `G28` → temp de impresión. |
| S5 | 🟠 Alto | Plantilla de inicio personalizada **sin homing** dejaba el Z absoluto en posición desconocida (riesgo de choque); prime line en `X3` muy al borde. | Aviso si la plantilla no contiene `G28`/`PRINT_START`/`G29`/`HOME`; prime line movida a `X5`. |
| S6 | 🟠 Alto | **`bedTemp` permitía 0°C** para materiales que sin cama caliente se despegan (ABS/ASA/PC/PA); `M190 S0` podía colgar. | Piso de cama por material (≥90° → 85% de la recomendada); se omite `M190` cuando la cama va a 0. PLA/PETG/TPU quedan libres. |
| S7 | 🟠 Alto | **Auto-calibración de tiempo cruzaba datos** entre impresoras: una clave global `sl_last_est_secs` se contaminaba en una granja con trabajos simultáneos. | Mapa por trabajo `sl_job_est_v1` (nombre→{secs,model}); calibra el modelo solo si ese archivo concreto tiene estimación y coincide el modelo. |
| S13 | 🟡 Medio | `descargar()` revocaba el ObjectURL a los 5 s (descargas lentas/móvil fallaban). | Anchor adjunto al DOM + revocación a los 60 s; guard si no hay G-code. |

### Datos / robustez

| # | Severidad | Problema | Fix |
|---|-----------|----------|-----|
| #4 | 🟠 Medio-Alto | **La cola de impresión se borraba al recargar** (`_printQueue` solo en memoria). | Rediseño: el G-code se sube a la impresora al **encolar** (Moonraker lo guarda) y la cola solo recuerda el nombre → persiste en `localStorage` (`printer_queue_v1`) y sobrevive a recargas. Se restaura en `initMaquinas`. |
| #3 | 🟠 Medio-Alto | **Historial solo en localStorage** (por navegador; se pierde al limpiar caché; no compartido). | Espejo a tabla Airtable `Maquinas_Historial` en cada impresión; en un navegador nuevo/limpio se restaura. *No* se fusiona sobre historial local existente (evita doble conteo). |
| #15 | 🟡 Medio (seg.) | **XSS/rotura por nombre de archivo** en el modal de subida (solo escapaba comillas simples). | El nombre se pasa por variable (`window._uploadedFileName`), no interpolado en HTML. |

---

## 2. Segunda tanda — endurecimiento (implementado)

### `printer-bridge` y comunicación
| Severidad | Problema | Fix |
|-----------|----------|-----|
| 🟡 Seg. | **Token del bridge en query string (`?bt=`)** → expuesto en logs del túnel. | Las llamadas REST ahora mandan el token por header `X-Bridge-Token` (vía `getPrinterAuthHeaders`, que es el chokepoint); `printerUrl` ya no lo pone en la query. `<img>` (cámaras/miniaturas) y WebSocket —que no pueden mandar headers— mantienen `?bt=`. Se auditaron **todos** los usos de `printerUrl`; el único `fetch` REST huérfano (`handleGcodeUpload`, que solo mandaba `X-Api-Key`) ahora usa `getPrinterAuthHeaders`. |
| 🟡 Seg. | **CORS `ALLOW_ORIGIN='*'`** fijo. | `BRIDGE_ALLOW_ORIGIN` ahora acepta una **lista de orígenes**; con lista, el bridge refleja solo el `Origin` permitido y añade `Vary: Origin`. Default `'*'` (sin romper instalaciones existentes). Requiere redeploy del bridge en el iMac. |

### Slicer SL3D
| # | Problema | Fix |
|---|----------|-----|
| S9 | Volumen sólido (cm³) erróneo en mallas no-manifold (alimenta el resumen para la IA). | Detección barata de bordes abiertos en `analyze` (cada arista de una malla cerrada aparece 2 veces); marca `S.stats.volApprox` y muestra `~`/"aprox." en el badge y en el resumen para la IA. No cambia el filamento real. |
| S10 | `gradualTemp` podía no dispararse en piezas de pocas capas y bajar temperatura de más. | Disparo robusto en la capa redondeada al 50%/80% (en vez de una ventana frágil) + clamp a un mínimo de extrusión seguro por material. |
| S14 | `fitsIn` ignoraba brim/skirt/draft-shield al decidir si "cabe". | Margen XY ahora incluye el ancho de la adhesión activa; criterio unificado con `_suggestPrinter`. |
| S15 | Índices fuera de rango en `parseOBJ`/`parse3MF` → NaN; `JSON.parse` ingenuo de la IA. | Se saltan/cuentan caras con índice inválido (sin NaN); la respuesta IA se valida (objeto con claves esperadas) antes de usarla, con fallback al perfil heurístico. |
| S11 | PA/arcos (Klipper) y M205 jerk (Marlin) se emitían sin conocer el firmware. | Flag `sl_firmware` (default `klipper`, toda la flota actual): gatea la emisión específica de cada firmware. Aditivo, sin cambio de comportamiento para la flota Klipper actual. |
| S8 | (Teórico) `_applyMinLayerTime` no ralentizaría líneas sin token `F`. | **Verificado: no es un bug en este código** — el slicer emite `F` en *todas* las líneas de extrusión, así que el `replace(/F.../)` siempre matchea. No se tocó. |

## 3. Recomendaciones aún abiertas (requieren decisión)

### `printer-bridge`
- **`X-Forwarded-For: 127.0.0.1` forzado**: intencional (cae en `trusted_clients` de
  Moonraker), pero implica que **cualquiera con el token controla las impresoras**.
  Tratar el token como secreto de alto valor y rotarlo si se filtra.
- **Sin límite de tamaño/rate-limit** en el proxy; `timeout:15000` de socket puede
  cortar subidas grandes de G-code en redes lentas.

### Arquitectura / producto
- **Webcam WebRTC (go2rtc)** para K2/K2 Plus en vez del snapshot cada 1 s.
- **WS multiplexado por el bridge**: un socket agregando las 14 máquinas en vez de 14
  conexiones desde el navegador.
- **Tests** del slicer (`estimate`, `clampParams`, `fitsIn`, `_deriveStatus`).
- **AMS/CFS** de la K2 (sistema multi-filamento).

## 3.b Capacidades nuevas (integración Moonraker)

Implementadas en esta rama (4 avances de la sección Máquinas):

1. **Historial real de Moonraker como fuente de verdad.** `syncMoonrakerHistory`
   lee `/server/history/list` por máquina (cada trabajo con `job_id` estable),
   dedup correcto y **fusión donde Moonraker manda**: `getHist`/`getPrintHours`/
   `getTotalFilamentKg` usan ese historial para las máquinas con `[history]` y el
   observado por el navegador solo como fallback → analítica exacta y compartida,
   **sin doble conteo** (resuelve de raíz el punto #3). Sincroniza al iniciar y
   ~cada 5 min.
2. **Power + versiones.** En el modal de control, sección "🖥️ Sistema": versión de
   Klipper/Moonraker, aviso de actualizaciones (`[update_manager]`) y botones
   encender/apagar por enchufe (`[power]`, `togglePrinterPower`).
3. **Cola con balanceo.** "Enviar a todas" ahora descarta máquinas donde la pieza
   **no cabe**, imprime en las libres y **encola en las ocupadas** (imprimen al
   quedar libres) en vez de mandar copias iguales y saltarse las ocupadas.
4. **Sensor de filamento (runout) + diagnóstico Klipper.** `ensureSensors` descubre
   los `filament_*_sensor` y los incluye en REST/WS; `_deriveStatus` marca `runout`,
   con badge "🧵 sin filamento" y alerta (browser/webhook/WhatsApp). En estado
   `shutdown`, `_klipperDiagnosis` parsea `klMsg` y sugiere causa probable + acción
   (termistor, MCU, timer too close, homing, etc.).

### Aún abierto
- **Analítica multi-usuario 100% exacta** para máquinas SIN `[history]` de Moonraker
  (firmware antiguo): ahí seguimos con el historial observado por el navegador.

---

## 4. Validación

- Los 7 bloques `<script>` de `index.html` y `printer-bridge/server.js` pasan la
  verificación de sintaxis (`node`).
- Todos los cambios son aditivos y de bajo riesgo; no se alteró el esquema de datos
  existente (las tablas nuevas `Maquinas_Historial` se crean bajo demanda, best-effort).
- **Importante (token por header):** el cambio del bridge requiere **redeploy** del
  `printer-bridge` en el iMac (el `server.js` ya aceptaba el header `X-Bridge-Token`,
  así que es retrocompatible, pero conviene actualizarlo para el cambio de CORS).
