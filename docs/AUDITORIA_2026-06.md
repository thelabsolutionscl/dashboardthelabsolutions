# Auditoría exhaustiva del Dashboard — The Lab Solutions

**Fecha:** 2026-06-22 · **Alcance:** `index.html` (SPA, 26.726 líneas / ~2,06 MB), `lead-worker/`, `sii-worker/`, `airtable-proxy/`, `printer-bridge/`, `mail-api.php`, `tests/`.
**Método:** revisión de solo lectura del código + ejecución de los tests. Severidades: 🔴 Crítico · 🟠 Alto · 🟡 Medio · ⚪ Bajo.

> **Estado de remediación (2026-06-22):** ✅ aplicada una primera ola de correcciones — ver §8. Lo implementado se hizo **retrocompatible** (la auth del backend solo se activa al definir su variable de entorno) para no romper los despliegues actuales. Para activar plenamente la seguridad del backend hay que configurar las variables de entorno y enviar las claves desde el dashboard (§8.3).

---

## 0. Resumen ejecutivo

El dashboard es funcionalmente muy completo y con bastante ingeniería de rendimiento ya hecha (memoización de filas, debounce, paginación incremental, refresco incremental por `LAST_MODIFIED_TIME`, caché stale-while-revalidate, retry/backoff). Los problemas más graves no son de UI sino **arquitectónicos y de dinero**:

1. **Toda la seguridad vive en el navegador.** El token de Airtable (PAT con acceso total a la base), la API key de Anthropic y la de OpenAI se guardan en `localStorage` y se usan en llamadas directas desde el browser. La autenticación (hashes en el código fuente) y el RBAC (solo `display:none`) son **cosméticos**: cualquier sesión válida —o cualquiera que abra la consola— puede leer/escribir/borrar toda la base saltándose los roles. **Existe un proxy Worker que ya resuelve esto pero es opcional; debe volverse obligatorio.**
2. **Bugs que cuestan plata, hoy, en producción:** la comisión de remuneraciones siempre sale $0; el recargo de urgencia +25% nunca se cobra; aprobar una cotización puede duplicar pedidos; las fechas por defecto se graban en UTC (día equivocado después de las ~20:00 hora Chile).
3. **El `sii-worker` (emisión de boletas/facturas electrónicas al SII) no tiene autenticación**: cualquiera que alcance el puerto puede emitir DTE reales consumiendo folios.

Los tests actuales **pasan** (`calc` 16 OK, `redes` 12 OK) pero **no cubren** ninguno de los bugs de abajo.

### Top 12 a corregir primero
| # | Hallazgo | Sev | Ref |
|---|---|---|---|
| 1 | Comisión de sueldos siempre $0 | 🔴 | `index.html:22579` |
| 2 | Recargo de urgencia +25% nunca aplicado al total | 🔴 | `index.html` (sin `*1.25`) |
| 3 | Aprobar cotización duplica pedidos (sin idempotencia + race) | 🔴 | `index.html:8633-8666` |
| 4 | `sii-worker` sin autenticación (emisión de DTE abierta) | 🔴 | `sii-worker/server.js:46-585` |
| 5 | RBAC cosmético + token Airtable en el browser = acceso total | 🔴 | `index.html:6431,18493` |
| 6 | API keys (Anthropic/OpenAI) expuestas en el navegador | 🔴 | `index.html:7292,6432` |
| 7 | Fechas por defecto en UTC (off-by-one nocturno) | 🟠 | `index.html` (~25 sitios) |
| 8 | Sesión en `localStorage` sin firma → escalar a admin trivial | 🟠 | `index.html:18454` |
| 9 | `mail-api.php`: inyección de cabeceras SMTP + sin rate-limit | 🟠 | `mail-api.php:135-242` |
| 10 | Edición/bulk de pedidos salta validaciones de estado | 🟠 | `index.html:10855-10888` |
| 11 | Numeración cotización/pedido se rompe y duplica | 🟠 | `index.html:6418,8665` |
| 12 | Inyección de prompt en agentes IA (datos de leads sin sanear) | 🟠 | `index.html:11037` |

---

## 1. Bugs de lógica de negocio (dinero y datos)

### 🔴 1.1 — La comisión en la liquidación de sueldos siempre es $0  · `index.html:22579`
```js
const comision = typeof vendorOwnsRecord!=='undefined' ? 0 : Math.round(sueldo>0?totalComision/personas.length:0);
```
`vendorOwnsRecord` es una función global declarada (`index.html:6436`), así que `typeof … !== 'undefined'` es **siempre true** → el reparto de la comisión 3,5% nunca ocurre y el "Sueldo neto" mostrado está incompleto.
**Fix:** la intención era ocultar comisiones en modo vendedor → `const comision = isVendorMode() ? 0 : Math.round(...)`.

### 🔴 1.2 — El recargo "Urgente (+25%)" nunca se cobra  · `index.html:2705, 8654, 11306`
El campo `Urgencia (+25%)` se guarda, ordena (`8562`) y muestra (`8614`), pero **no hay ninguna multiplicación `*1.25`** sobre el precio en ningún lado. El +25% solo existe como texto en el prompt de Claude (`6006`). Toda cotización urgente se cobra a precio normal → pérdida directa de margen.
**Fix:** al calcular el neto en `createCotizacion`/`updateItemsTotal`, `if(urgente) neto = Math.round(neto*1.25)` antes del IVA.

### 🔴 1.3 — Aprobar una cotización puede duplicar pedidos  · `index.html:8633-8666`
`updateCotizacionEstado(id,'Aprobada')` llama a `crearPedidoDesdeCotizacion` sin verificar si ya estaba aprobada o si ya existe pedido asociado; re-aprobar o doble clic crea otro. Además el N° de pedido se calcula como `maxNum+1` sobre `state.pedidos` local → dos usuarios casi simultáneos generan **el mismo N°**.
**Fix:** marcar `Pedido asociado` y abortar si existe; `btn.disabled` durante la operación; idealmente generar el correlativo en backend.

### 🟠 1.4 — Fechas por defecto grabadas en UTC, no en hora de Chile  · ~25 sitios
Patrón `new Date().toISOString().slice(0,10)` (p.ej. `8294, 8484, 10857, 11218, 11303, 13698…`). A las 22:30 de Chile (UTC-4) produce el **día siguiente**. Afecta Fecha cotización/despacho/factura/primer contacto/envío newsletter, vencimientos, reportes y comisiones por período.
**Fix:** helper único `fechaHoyCL()` → `new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})` y usarlo en todos esos puntos.

### 🟠 1.5 — Edición y cambio masivo de pedidos saltan TODAS las validaciones  · `index.html:10855-10888`
`advancePedido` valida saldo 50% antes de despachar, QA aprobado y abono antes de producción. Pero `saveEditPedido` y `bulkEditPedidoEstado` permiten poner cualquier estado (incluso **"Despachado" sin saldo ni QA**), y permiten retroceder/saltar estados. No hay tabla de transiciones.
**Fix:** centralizar las guardas en una función de transición y aplicarla en los 3 caminos.

### 🟠 1.6 — La numeración de cotización se rompe y duplica pasadas 99/mes  · `index.html:6418`
El filtro exige `num.length===6` (prefijo 4 + 2 dígitos); en la cotización n.º 100 el largo cambia y deja de contarse → `maxSeq` vuelve a 99 → duplicados. Mismo problema de race que 1.3.
**Fix:** parsear el sufijo numérico sin asumir 2 dígitos; correlativo en backend.

### 🟠 1.7 — El throttle de auto-refresh anula los reload tras escritura  · `index.html:5641, 7233`
`loadAllDataSilent` retorna temprano si pasaron <10 min (`MIN_REFRESH_MS`). Como casi todos los flujos guardan y luego llaman `loadAllDataSilent()`, ese reload **se omite**; la UI queda solo con la mutación optimista local y no refleja campos calculados/automatizaciones de Airtable hasta 10 min después. En multiusuario se pisan cambios sin avisar.
**Fix:** que las recargas tras escritura propia fuercen `force=true`, reservando el throttle solo para el ciclo automático.

### 🟡 1.8 — `calcDiasMora` mezcla medianoche UTC con hora local  · `index.html:8102`
`new Date("YYYY-MM-DD")` parsea UTC, pero se resta `Date.now()` (instante real) → ~4h de sesgo → off-by-one en mora cerca de límites de día. **Fix:** parsear con `+'T00:00:00'` (local) como en otras partes.

### 🟡 1.9 — Descuento sin clamp → totales negativos  · `index.html:11260, 11300`
`descPct=parseFloat(...)||0` sin tope; un descuento >100% da `Total final` negativo que se propaga a margen y liquidación. **Fix:** `Math.min(100,Math.max(0,desc))` (o un máximo permitido).

### 🟡 1.10 — Folio de factura duplicado falla con ceros a la izquierda  · `index.html:8335 vs 8342`
La verificación compara string (`"001"`) contra entero guardado (`1`) → permite duplicados lógicos; folio no numérico se guarda como `null` en silencio. **Fix:** normalizar a número en ambos lados y validar que sea numérico.

### 🟡 1.11 — Round-trip de ítems vía `Detalle productos` puede alterar montos  · `index.html:8688 vs 11281`
Los ítems se serializan a texto (`Costo: $x | Venta: $y`) y al editar se re-parsean quitando puntos y dividiendo por `und`; si una descripción contiene `|` o cambió `und`, los unitarios reconstruidos difieren. **Fix:** persistir los ítems como JSON estructurado, no reconstruir desde el texto formateado.

### ⚪ 1.12 — Detalles menores
- `parseInt` sin radix en todo el código (`5982, 6418, 8272…`) → usar `parseInt(x,10)`.
- `formatCLP` muestra `NaN` como `$0`, ocultando datos corruptos en KPIs (`7299`).
- Conjuntos de nombres de estado inconsistentes en el orden de grupos (`8581`); canonizar.

---

## 2. Seguridad

### Frontend (`index.html`)

> El código usa `escapeHtml()`/`safeHref()` de forma bastante consistente; el XSS efectivo es limitado. Lo grave es la exposición de credenciales y la autorización en cliente.

- 🔴 **2.1 RBAC puramente cosmético** (`18493-18575`). `applyRBAC` solo hace `display:none`; los chequeos `canWriteTable`/`canDeleteRole` corren en el cliente. Con el token en `localStorage`, cualquier rol (incluso `demo`/`marketing`) puede llamar a Airtable directo y leer/escribir/borrar todo. → Autorización **server-side** en el Worker.
- 🔴 **2.2 PAT de Airtable en `localStorage`** (`6431, 6596`), legible por XSS/extensiones. → Usar el proxy Worker como **única** vía; tokens efímeros/scoped.
- 🔴 **2.3 Anthropic key directo desde el browser** (`7292`, con `anthropic-dangerous-direct-browser-access:true`). → Forzar `_callClaudeViaProxy` y eliminar el modo raw.
- 🔴 **2.4 OpenAI key directo desde el browser** (`6432`, usos en `9183…9383`). → Enrutar por el Worker.
- 🟠 **2.5 Hashes de contraseña en el código fuente** (`18435`): SHA-256 de un solo paso, salt estático `'thelab.v2:'`, sin PBKDF2/bcrypt → crackeo offline trivial. Además `nicanor@` y `gustavo@` comparten el **mismo hash** (misma contraseña). → Auth en backend con KDF lento + salt por usuario; rotar ya las dos claves admin idénticas.
- 🟠 **2.6 Sesión sin firma** (`18454`): `{role,expires}` en `localStorage` sin HMAC; escribir `role:'admin'` a mano = admin sin contraseña. → Token de sesión firmado y validado server-side.
- 🟠 **2.7 Inyección de prompt en agentes IA** (`11037`, QA `10771`, etc.): campos de leads/clientes (texto libre, notas) entran crudos al prompt de Claude y el output se persiste y dirige decisiones. → Delimitar/marcar contenido no confiable, validar campos extraídos, no auto-actualizar sin revisión.
- 🟡 **2.8 Portal de cliente IDOR** (`22686`): `?portal=base64(recordId)`; el "token" no es secreto. → Tokens aleatorios por cliente validados server-side.
- 🟡 **2.9 HTML de correo en `iframe srcdoc` con `allow-same-origin`+`allow-popups`** (`17947`). → Sanitizar (DOMPurify) y endurecer el sandbox.
- 🟡 **2.10 `new Function(onclick)`** al cerrar modales (`18755`): hoy no explotable (atributo propio) pero es un sink peligroso. → Reemplazar por referencia de función.
- ⚪ **2.11** `target="_blank"` sin `rel="noopener"` en varios enlaces (`2083, 4352…`), inconsistente. ⚪ **2.12** `href` dinámicos que no pasan por `safeHref()` (`8197, 18862`). ⚪ **2.13** defaults `%%PLACEHOLDER%%` (`5763`): verificar que el build público **no** inyecte secretos en el HTML estático.

### Backend (workers + PHP)

- 🔴 **2.14 `sii-worker/server.js:46-585` sin auth.** Cualquiera con acceso al puerto puede `POST /` (emitir DTE reales y consumir folios), `PUT /caf` (sobrescribir CAFs/resetear folios), `GET /test-emit` (emite factura real sin parámetros). `app.listen(PORT,'0.0.0.0')`. → Header secreto con comparación constante en todo el router; bindear a `127.0.0.1`; quitar endpoints de test en prod.
- 🔴 **2.15 `mail-api.php:21-28` reenvía `user`/`pass` del buzón en cada request y sin rate-limit** → oráculo de fuerza bruta; XSS filtra credenciales en claro. → Sesión/token en vez de reenviar `pass`; rate-limit + CAPTCHA tras N fallos.
- 🔴 **2.16 `sii-worker` `GET /debug`,`/test-cert`,`/test-token`** filtran IP de salida, metadata del `.pfx` y parte del token de sesión SII. → Eliminar/proteger en prod.
- 🟠 **2.17 `mail-api.php:135-242` inyección de cabeceras SMTP (CRLF)** en `to/cc/subject/from_name` → relay de spam/phishing. → Strip de `\r\n` + `FILTER_VALIDATE_EMAIL`. (Y 🔴 **2.18** inyección IMAP SEARCH con `addslashes` insuficiente, `:486`.)
- 🟠 **2.19 `printer-bridge` token en query string `?bt=`** (`:87`) → queda en logs/Referer; comparación no constante (`:88`). Spoofea `X-Forwarded-For:127.0.0.1` para eludir auth de Moonraker (`:126`): quien tiene el token controla las impresoras. → Token solo por header + `timingSafeEqual`.
- 🟠 **2.20 `sii-worker` CORS `*`** (`:48`) en API de facturación → CSRF cross-origin. → Allowlist de orígenes + auth (2.14).
- 🟡 **2.21 `airtable-proxy/src/worker.js`**: comparación de `APP_KEY` no constante (`:24`), CORS `*` (`:4`), passthrough de **cualquier** método/path a Airtable y Anthropic. → Comparación constante, CORS al dominio del dashboard, allowlist de tablas/métodos, rate-limit del passthrough Anthropic (tope de costo).
- 🟡 **2.22 `sii-worker` race en asignación de folios** (`server.js:686`): lee→+1→persiste tras upload; dos requests obtienen el mismo folio; KV file-based no atómico; sin idempotency-key. → Lock/reserva del folio antes del upload + `idempotency-key`.
- 🟡 **2.23** Logging de material sensible en `sii-auth.js` (`158,167,218`: XML firmado, token, respuesta DTE). 🟡 **2.24** `lead-worker` HMAC del newsletter cae a literal `"thelab-newsletter"` si falta `NEWSLETTER_SECRET` (`index.js:486`) → falsificar opt-in/bajas; fallar cerrado. 🟡 **2.25** CORS Vercel demasiado laxo (`index.js:1326`, regex `web-thelab-solutions*.vercel.app`).
- 🟡 **2.26 PII fiscal real commiteada**: `sii-worker/.env.example` y `setup-secrets.sh` traen RUT, razón social y resolución de WAST3D SPA. → Placeholders genéricos; verificar que `cert/*.pfx` no se haya commiteado.
- ⚪ **2.27** Sin timeouts en `fetch` a SII/Airtable/Resend/Anthropic (salvo printer-bridge). → `AbortController`.

**Positivo:** `lead-worker` es el componente más maduro (comparación constante `timingSafeEqual`, honeypot, Turnstile, rate-limit KV, dead-letter buffer con reintento por cron, guardrail de costo diario de Claude). `printer-bridge` valida bien IPs privadas y puertos (defensa SSRF sólida salvo el token en URL). No se hallaron secretos vivos en archivos rastreados (salvo la PII fiscal de 2.26).

---

## 3. UX · Accesibilidad · Rendimiento

### Accesibilidad (la categoría más débil)
- 🟠 **3.1** Toasts/errores sin `aria-live`/`role=status` → invisibles para lectores de pantalla. (esfuerzo S)
- 🟠 **3.2** Modales sin patrón accesible: sin `role="dialog" aria-modal`, sin focus-trap, sin restaurar foco, Escape ad-hoc. → Helper único `openModal/closeModal` que reemplace los ~12 patrones `display:flex/none`. (M)
- 🟠 **3.3** Solo 8 `alt` para 36 `<img>` y 5 `aria-label` para 924 `onclick` → botones-ícono sin nombre accesible. (M)
- 🟡 **3.4** Contraste: `--text3:#777` ≈ 3.6:1 (bajo WCAG AA); color como único indicador en algunos estados. (M)
- 🟡 **3.5** Barra de tabs sin `role=tablist/tab/tabpanel` ni navegación por flechas. (Bien: respeta `prefers-reduced-motion`.)

### UX/UI
- 🟠 **3.6** Sin **undo** tras eliminar (cliente/cotización/pedido/factura). → Patrón "eliminado · Deshacer" en toast con borrado diferido. (M)
- 🟡 **3.7** Confirmaciones destructivas con `window.confirm()` nativo (43 usos) → reemplazar por modal propio. (M)
- 🟡 **3.8** Si una de las 7 tablas falla en el `Promise.allSettled`, se ignora en silencio → banner por-tabla "reintentar". (S)
- ⚪ **3.9** Dos `globalSearchInput` duplicados (`1613` y `5540`) → consolidar.

### Rendimiento (ya hay mucho hecho; oportunidades reales)
- 🟠 **3.10** 2,06 MB inline sin minificar + `<meta Cache-Control: no-cache>` (`:8`) → revalida ~2 MB cada visita. → Build mínimo (esbuild/terser) + nombre con hash + `Cache-Control: immutable` (~40-55% menos peso, el mayor ROI de la categoría). (M)
- 🟡 **3.11** CDNs sin SRI: `html2pdf` y `gsi/client` (`1462-1463`). → `integrity`+`crossorigin` o auto-alojar html2pdf. (S)
- 🟡 **3.12** Arranque carga 7 tablas (hasta 1000 reg c/u). → Lazy por pestaña activa; diferir tablas pesadas. (M)
- ⚪ **3.13** Tablas con "mostrar más" (cap 80) pero sin virtualización; suficiente hoy, revisar si superan ~2-3k filas.

### PWA / Offline — ausente
- 🟠 **3.14** Sin service worker, sin `manifest.json`, sin `caches`. → Manifest (instalable, alto valor para taller/terreno) + SW (app-shell cache-first, datos SWR). (M)
- 🟡 **3.15** Sin indicador de conexión perdida ni cola de escrituras offline. (M)

### Observabilidad
- 🟠 **3.16** `ERRLOG` (`:5643`) es anillo en memoria + 25 en localStorage, **no se reporta a ningún backend** → enviar batched al Worker/Sentry. (S, alto valor)
- ⚪ **3.17** Sin analítica de uso (qué pestañas/acciones).

---

## 4. Arquitectura y mantenibilidad
- 🟠 **4.1** Monolito de 26,7k líneas, sin módulos/tipos, 1.085 handlers inline acoplando HTML↔JS vía globals.
  **Plan de bajo riesgo, incremental (sin reescritura ni framework):**
  1. Extraer CSS a `styles.css` y JS a `app.js`.
  2. Dividir `app.js` por dominios con ESM (`data/airtable.js`, `agents/claude.js`, `ui/modal.js`, `render/*.js`, `state.js`) + bundler esbuild.
  3. Migrar `onclick="fn()"` → `addEventListener` por delegación, una pestaña por PR.
  4. Añadir `// @ts-check` + JSDoc en los módulos de datos (captura errores sin migrar de lenguaje).
- 🟡 **4.2** Duplicación: doble search, modales copy-paste, body de Anthropic repetido en `callClaude`/`_callClaudeRaw`/KAI → centralizar un cliente Anthropic único.

---

## 5. Upgrades y funcionalidades nuevas de alto valor
- 🟠 **5.1** Centralizar el **ID de modelo IA** en config (hoy `claude-sonnet-4-6` está hardcodeado en `7278, 23390, 23630`). *Nota: `claude-sonnet-4-6` es un modelo vigente y de los más recientes — no está desactualizado; el valor está en hacerlo configurable, no en cambiarlo con urgencia.* (S)
- 🟠 **5.2** Extender **KAI con tool-use** (ya usa `stream:true`+`KAI_TOOLS` en `23630`) para crear/editar cotizaciones y pedidos con confirmación, no solo lectura. (M)
- 🟠 **5.3** **Inbox WhatsApp (WATI) bidireccional** en la ficha de cliente con respuestas sugeridas por Claude (patrón análogo al polling de correo `_mailCheck`). (M)
- 🟠 **5.4** **SII: monitor de estado de DTE** (aceptado/rechazado/reparos) con alertas + conciliación Facturas↔Pedidos. (M)
- 🟠 **5.5** **Agente de cobranzas:** facturas vencidas → recordatorios automáticos WhatsApp/email con tono configurable. (M)
- 🟡 **5.6** **Notificaciones push** (vía el SW de 3.14) para producción/QA/pedidos atrasados. (M)
- 🟡 **5.7** Estado de **impresoras 3D** (printer-bridge ya tiene `pollPrinters`) en el overview con alertas de fin/fallo de trabajo. (S)

---

## 6. Tests
- `node tests/calc.test.js` → **16 OK** · `node tests/redes.test.js` → **12 OK**.
- `node --test tests/` falla porque los archivos usan un runner propio, no `node:test` (no es un bug del producto, pero conviene unificar bajo un runner y un `npm test`).
- **Cobertura faltante (recomendado añadir):** recargo de urgencia (1.2), reparto de comisión (1.1), generación de fecha local CL (1.4), idempotencia de aprobación→pedido (1.3), clamp de descuento (1.9), guardas de transición de pedidos (1.5).

---

## 7. Plan de remediación sugerido (por orden)
1. **Sprint 1 — Dinero/datos (rápido, alto impacto):** 1.1, 1.2, 1.3, 1.4, 1.9 + tests asociados.
2. **Sprint 2 — Seguridad backend:** 2.14, 2.16 (sii-worker auth), 2.15/2.17 (mail-api), 2.19 (printer-bridge), 2.21/2.22 (proxy + folios).
3. **Sprint 3 — Seguridad frontend (arquitectónico):** hacer el **proxy Worker obligatorio** para Airtable+Anthropic+OpenAI (resuelve 2.1–2.4 de raíz), auth/sesión server-side (2.5, 2.6), saneo de prompts (2.7).
4. **Sprint 4 — UX/a11y/resiliencia:** 3.1/3.2 (aria-live + focus-trap), 3.6 (undo), 3.10 (build minificado), 3.14 (PWA), 3.16 (reportar ERRLOG).
5. **Continuo:** modularización 4.1 (una pestaña por PR) y upgrades del §5 según prioridad de negocio.

---

## 8. Estado de remediación — ola 1 (2026-06-22)

### 8.1 Implementado en el frontend (`index.html` + `tests/`)
| Hallazgo | Estado | Nota |
|---|---|---|
| 1.1 Comisión siempre $0 | ✅ | `isVendorMode()` |
| 1.2 Urgencia +25% no cobrada | ✅ | helper `aplicaUrgencia()` en crear/editar/toggle/display |
| 1.3 Pedidos duplicados al aprobar | ✅ | idempotencia (estado previo + flag anti doble-clic). *Persiste el riesgo de race entre usuarios distintos: requiere correlativo en backend.* |
| 1.4 Fechas en UTC | ✅ | `fechaHoyCL()` en 36 sitios (timestamps con hora intactos) |
| 1.5 Edición/masivo saltan validaciones | ✅ | `_bloqueoDespacho()` centralizado en avanzar/editar/lote |
| 1.6 Numeración cotización >99 | ✅ | parseo de sufijo sin asumir 2 dígitos |
| 1.7 Throttle anula reload tras escritura | ✅ | `loadAllDataSilent(force=true)` por defecto; automáticos en `false` |
| 1.8 `calcDiasMora` UTC | ✅ | medianoche local |
| 1.9 Descuento sin clamp | ✅ | clamp `[0,100]` en display/crear/editar |
| 1.10 Folio duplicado con ceros | ✅ | comparación numérica + validación |
| 2.9 iframe correo `allow-same-origin` | ✅ | sandbox endurecido (sin same-origin/scripts) |
| 2.10 `new Function(onclick)` | ✅ | reemplazado por `backdrop.click()` |
| 2.11 `target=_blank` sin `rel` | ✅ | `rel="noopener noreferrer"` en 20 enlaces |
| 3.1 Toasts sin `aria-live` | ✅ | `role`/`aria-live` (error=assertive) |

### 8.2 Implementado en el backend (retrocompatible)
| Componente | Cambio |
|---|---|
| `sii-worker` | Auth `X-SII-Key` (si `SII_API_KEY`), debug gateado (`SII_DEBUG=1`), CORS (`SII_ALLOW_ORIGIN`), folios con mutex + rollback, logs sensibles tras debug, `.env.example`/`setup-secrets.sh` sin PII real, `.gitignore` cubre certificados |
| `mail-api.php` | Anti-CRLF en cabeceras, validación de emails, IMAP SEARCH escapado, rate-limit por IP (429) |
| `printer-bridge` | Token por `X-Bridge-Token` + comparación constante (`?bt=` deprecado, sigue funcionando) |
| `airtable-proxy` | `APP_KEY` constante, CORS por `ALLOWED_ORIGINS`, allowlist opcional `ALLOWED_TABLES` |
| `lead-worker` | `nlSecret()` sin literal predecible, CORS de previews Vercel acotado |

### 8.3 Pasos de configuración para activar la seguridad del backend
1. **sii-worker**: definir `SII_API_KEY` (genera una con `openssl rand -hex 32`), `SII_ALLOW_ORIGIN` (origen del dashboard) y dejar `SII_DEBUG` sin `1` en producción. En el dashboard: *Configuración SII → "Clave del Worker (X-SII-Key)"* con el mismo valor.
2. **airtable-proxy**: definir `ALLOWED_ORIGINS` (dominios del dashboard) y, opcionalmente, `ALLOWED_TABLES`.
3. **lead-worker**: definir `NEWSLETTER_SECRET`; si la web de producción usa `web-thelab-solutions.vercel.app` "plano", añadirlo a `ALLOWED_ORIGINS`.
4. **printer-bridge**: migrar (opcional) las llamadas a `X-Bridge-Token`; el `?bt=` sigue operativo.
5. Verificar que ningún certificado `.pfx`/`.p12` esté en el repo (ya cubierto por `.gitignore`).

### 8.4 Pendiente (requiere infraestructura/decisión de producto, NO incluido en esta ola)
- **Seguridad arquitectónica frontend (2.1–2.6):** sacar el PAT de Airtable y las API keys (Anthropic/OpenAI) del navegador haciendo el **proxy Worker obligatorio**, y mover **auth de sesión y RBAC a server-side** con KDF lento (bcrypt/PBKDF2) y sesión firmada. Es el cambio de mayor impacto y exige backend desplegado; planificar como proyecto aparte. Rotar de inmediato las dos contraseñas admin idénticas.
- **2.7 Inyección de prompt** en agentes IA: delimitar datos no confiables y validar campos extraídos antes de persistir.
- **Sprint 4 UX** (focus-trap de modales, undo en borrados, build minificado, PWA/offline, reporte de `ERRLOG`) y **modularización** (§4).
- **Upgrades** del §5 (tool-use en KAI, inbox WhatsApp, monitor de DTE, agente de cobranzas, push) según prioridad de negocio.

### 8.5 Verificación
- Tests: `node tests/calc.test.js` → **24 OK** (16 originales + 8 nuevos de regresión), `node tests/redes.test.js` → **12 OK**.
- Sintaxis: JS inline del `index.html` y los 6 archivos JS de backend pasan `node --check`; `mail-api.php` pasa `php -l`.

---

## 9. Remediación — ola 2 (2026-06-22): UX, resiliencia y agentes

| Hallazgo | Estado | Implementación |
|---|---|---|
| 3.1/3.2 a11y de modales | ✅ | Escape para cerrar + focus-trap (Tab) global sobre el modal superior, sin reescribir cada modal |
| 3.6 Undo en borrados | ✅ | `toastUndo` extendido a Factura, Cotización y Pedido (Cliente y Proveedor ya lo tenían) |
| 3.14 PWA / offline | ✅ | `manifest.json` (instalable) + `sw.js` (service worker **network-first**: nunca sirve contenido viejo, solo añade offline) + registro en el `<head>` |
| 3.16 Reporte de `ERRLOG` | ✅ | Envío best-effort batched (sendBeacon/fetch keepalive) a `localStorage['errlog_endpoint']`; no-op si no se configura |
| 2.7 Inyección de prompt (agente cola) | ✅ (mitigación) | `processAgentQueueItem`: datos del lead delimitados (`<lead_data>`) con instrucción de tratarlos solo como datos |

> **PWA — nota:** los iconos del `manifest.json` apuntan al logo remoto de `thelab.solutions`. Para una instalación óptima conviene añadir iconos propios de 192×192 y 512×512 en el mismo origen. Para configurar el reporte de errores: `localStorage.setItem('errlog_endpoint','<URL del colector>')`.

### Sigue pendiente (requiere backend / decisión de producto)
- Seguridad arquitectónica frontend (2.1–2.6): proxy obligatorio + auth/RBAC server-side con KDF lento y sesión firmada; **rotar las 2 contraseñas admin idénticas** ya.
- Build minificado con hash (3.10), virtualización de tablas muy grandes (3.13), modularización (§4) y upgrades del §5.

### Verificación ola 2
- `node tests/calc.test.js` → **24 OK**, `node tests/redes.test.js` → **12 OK**.
- Sintaxis: 8 bloques `<script>` inline válidos; `sw.js` pasa `node --check`; `manifest.json` es JSON válido.
