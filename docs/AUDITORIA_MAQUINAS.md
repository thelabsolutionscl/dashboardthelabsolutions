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

## 2. Recomendaciones no aplicadas (requieren decisión o despliegue aparte)

### 📋 `printer-bridge` (se despliega en el iMac; cambiarlo afecta instalaciones vivas)
- **Token en query string (`?bt=`)**: queda en logs de Cloudflare Tunnel y en el DOM
  (src de cámaras/miniaturas). Para WebSocket e `<img>` del navegador es inevitable
  (no se pueden poner headers), pero las llamadas REST podrían mandarlo por header
  `X-Bridge-Token`. Cambiar todos los `fetch` es invasivo → se deja documentado.
- **CORS `ALLOW_ORIGIN='*'` por defecto**: mitigado por el token, pero conviene fijar
  el origen del dashboard en producción (variable `BRIDGE_ALLOW_ORIGIN`).
- **`X-Forwarded-For: 127.0.0.1` forzado**: intencional (cae en `trusted_clients` de
  Moonraker), pero implica que **cualquiera con el token controla las impresoras**.
  Tratar el token como secreto de alto valor y rotarlo si se filtra.
- **Sin límite de tamaño/rate-limit** en el proxy; `timeout:15000` de socket puede
  cortar subidas grandes de G-code en redes lentas.

### 📋 Slicer (mejoras de precisión/robustez, no bugs bloqueantes)
- **S11** Gating de firmware por máquina: `SET_PRESSURE_ADVANCE` (Klipper) y arcos
  `G2/G3` se emiten sin verificar el firmware real. Hoy todas las máquinas corren
  Klipper, así que es seguro; añadir un campo `flavor`/`caps` por máquina lo blindaría.
- **S8** `_applyMinLayerTime` no ralentiza líneas que heredan el feedrate (sin token `F`).
- **S9** El volumen sólido (cm³) por divergencia es erróneo en mallas no-manifold
  (alimenta el resumen para la IA; el filamento real del G-code no lo usa).
- **S10** `gradualTemp` puede no dispararse en piezas de pocas capas o bajar temperatura
  en una capa con puente.
- **S14** `fitsIn` ignora skirt/brim/raft/draft-shield y la prime line al decidir si "cabe".
- **S15** Validación de índices fuera de rango en `parseOBJ`/`parse3MF` y del `JSON.parse`
  de la respuesta IA.

### 📋 Arquitectura / producto
- **Analítica compartida real**: el espejo de historial (#3) restaura solo si el
  navegador no tiene datos, para no doblar el conteo. Una analítica multi-usuario
  exacta necesita un *id de trabajo estable* (no el `Date.now()` del observador),
  idealmente leyendo `/server/history/list` de Moonraker como fuente de verdad.
- **Power devices / update_manager de Moonraker**: encender/apagar máquinas y ver
  versión de Klipper/actualizaciones desde el dashboard.
- **Webcam WebRTC (go2rtc)** para K2/K2 Plus en vez del snapshot cada 1 s.
- **WS multiplexado por el bridge**: un socket agregando las 14 máquinas en vez de 14
  conexiones desde el navegador.

---

## 3. Validación

- Los 7 bloques `<script>` de `index.html` y `printer-bridge/server.js` pasan la
  verificación de sintaxis (`node`).
- Todos los cambios son aditivos y de bajo riesgo; no se alteró el esquema de datos
  existente (las tablas nuevas `Maquinas_Historial` se crean bajo demanda, best-effort).
