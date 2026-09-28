# Auditoría maestra — Dashboard The Lab Solutions

Fecha de inicio: 2026-09-26  
Rama de arranque: `audit/master-p0-security-20260926`  
Objetivo: auditar el dashboard completo por dominios, reparar primero los riesgos críticos y dejar cada hallazgo trazable con prueba o criterio de aceptación.

## Cómo se trabajará

Estados: **PENDIENTE**, **EN AUDITORÍA**, **CORREGIDO**, **BLOQUEADO EXTERNO**.  
Prioridades: **P0** riesgo de seguridad/pérdida de datos/gasto; **P1** lógica de negocio/fiabilidad; **P2** UX/rendimiento; **P3** mejora.

Cada bloque debe revisar cinco capas cuando apliquen:

1. Seguridad y permisos.
2. Fuente de verdad, lógica, estados y persistencia.
3. Integraciones, errores, reintentos e idempotencia.
4. Interfaz desktop/móvil, accesibilidad y feedback.
5. Pruebas, observabilidad, costo y recuperación.

## Mapa de auditoría

| # | Dominio | Prioridad inicial | Estado | Foco |
|---|---|---:|---|---|
| 01 | Seguridad, identidad y secretos | P0 | EN AUDITORÍA | autenticación real, RBAC server-side, secretos, CORS, rate limit, auditoría |
| 02 | IA, agentes y gasto de tokens | P0 | EN AUDITORÍA | Anthropic/OpenAI, hard caps, modelos, concurrencia, caché, atribución de costo |
| 03 | Datos, Airtable, caché y sincronización | P0 | EN AUDITORÍA | snapshots parciales, paginación, dedupe, rollback, conflictos |
| 04 | Cotizaciones | P1 | EN AUDITORÍA | cálculo, estados, aprobación→pedido, documentos, edición |
| 05 | Pedidos | P1 | EN AUDITORÍA | lifecycle, pagos, despacho, tarjetas/tabla, integridad de relaciones |
| 06 | Finanzas y Facturas | P0/P1 | EN AUDITORÍA | revenue, saldos, IVA, DTE, caja, idempotencia |
| 07 | Clientes / CRM / Recompras | P1 | PENDIENTE | ownership, historial, cadencias, acciones y trazabilidad |
| 08 | Máquinas / granja / cámaras | P0/P1 | PENDIENTE | bridge, auth, telemetría, estados, recuperación, falsas alarmas |
| 09 | Cola / trabajos / producción 3D | P1 | PENDIENTE | lifecycle durable, asignación, reimpresión, concurrencia |
| 10 | Slicer / simulación / Visual AI | P1/P2 | PENDIENTE | fiabilidad, permisos, iframe, costo IA, errores |
| 11 | Calendario / Drive / documentos | P1 | PENDIENTE | OAuth, sincronización, fechas, permisos, archivos |
| 12 | Correo / notificaciones / WhatsApp | P0/P1 | PENDIENTE | remitentes, sanitización, tracking, rate limit, evidencia de envío |
| 13 | Proveedores / compras / OC | P1 | EN AUDITORÍA | lifecycle, precios, moneda/IVA, entregas, validación |
| 14 | Equipo / remuneraciones | P1 | PENDIENTE | comisiones, metas, vigencia, disponibilidad, persistencia |
| 15 | Web / SEO / Google Ads | P0/P1 | PENDIENTE | credenciales, mutaciones, rollback, métricas, secretos |
| 16 | Redes sociales / newsletter | P1 | PENDIENTE | consentimiento, dedupe, métricas, enlaces, publicaciones |
| 17 | Overview / Reportes / CEO / Oficina | P1 | PENDIENTE | KPIs, fuente de verdad, ventanas temporales, healthchecks |
| 18 | Navegación / UI / responsive | P2 | PENDIENTE | alineación, modales, densidad, consistencia TLS, móvil |
| 19 | Accesibilidad | P2 | PENDIENTE | teclado, focus, contraste, roles, lectores |
| 20 | Rendimiento / PWA / caché | P1/P2 | PENDIENTE | carga inicial, SW, stale data, polling, memoria |
| 21 | CI/CD / backups / observabilidad | P0/P1 | EN AUDITORÍA | tests, deploy, rollback, backups, alertas, recovery |

## Hallazgos confirmados al iniciar

### P0-SEC-001 — APP_KEY + Origin no equivalen a autenticación

**Estado:** ABIERTO / arquitectura.  
El proxy reconoce que `APP_KEY` puede estar disponible en el cliente. El allowlist de `Origin` frena abuso desde otro sitio en un navegador, pero un cliente HTTP puede enviar ese header. El RBAC que vive en el navegador tampoco puede ser la última autoridad.

**Objetivo final:** sesión server-side verificable y autorización en backend por usuario, rol, tabla, fila y operación.  
**Criterio de cierre:** una petición válida en CORS pero sin una sesión firmada no puede leer/escribir Airtable ni ejecutar servicios privados.

### P0-AI-001 — OpenAI funcionaba como proxy genérico sin hard cap

**Estado:** CORREGIDO EN ESTA RAMA.  
Se acotó OpenAI a:
- chat: `gpt-4o-mini`, salida máxima acotada;
- generación: `gpt-image-1`, una imagen, 1024×1024, calidad low;
- edición: `gpt-image-1`, una imagen, 1024×1024, calidad low y entrada acotada.

Todas las llamadas OpenAI reservan presupuesto en el mismo guard global de IA que Anthropic. Endpoints o modelos no permitidos fallan cerrados.

### P0-SEC-002 — OpenAI secret podía hornearse en index.html

**Estado:** CORREGIDO EN ESTA RAMA.  
El workflow de GitHub Pages todavía inyectaba `secrets.OPENAI` en el HTML estático. Esa inyección fue eliminada y el cliente ya no tiene fallback directo a `api.openai.com`.

**Acción operacional pendiente tras merge:** rotar cualquier OpenAI key que haya podido estar publicada anteriormente.

### P0-SEC-003 — OpenAI key persistida en localStorage

**Estado:** CORREGIDO EN ESTA RAMA.  
Las pantallas de configuración purgan la clave legada y OpenAI queda administrado únicamente por Proxy Worker.

### P0-DATA-001 — cargas parciales podían ocultar pedidos

**Estado:** CORREGIDO previamente; REQUIERE REGRESIÓN.  
Ya existen cambios recientes para evitar cachear snapshots parciales y para reconstruir Pedidos desde Airtable. La auditoría de datos verificará que el mismo patrón se aplique a todas las tablas críticas.

### P1-DATA-002 — Creación de proveedor podía duplicarse

**Estado:** CORREGIDO.  
El fallback de creación hacía un segundo POST después de cualquier error, incluso timeout o fallo posterior al alta. Ahora solo existe fallback cuando Airtable confirma un rechazo de esquema; red, timeout y 5xx no se reintentan como creación nueva. El refresco posterior está aislado de la mutación.

### P1-DATA-003 — Editar proveedor no permitía borrar campos

**Estado:** CORREGIDO.  
El PATCH descartaba cadenas vacías/null y por eso teléfono, web, notas, condiciones u otros campos no podían limpiarse. En edición los valores vacíos se conservan para que Airtable pueda borrar el valor.

### Riesgos abiertos en Proveedores

- reemplazar relaciones por nombre por `recordId` estable;
- numeración OC reservada de forma atómica en backend;
- migrar precios/OC desde blobs completos a registros versionados;
- configuración de categorías compartida en vez de localStorage;
- trazabilidad de aprobación/rechazo con actor, fecha, evidencia e historial.

### P0-SEC-004 — Worker SII podía quedar abierto por configuración

**Estado:** CORREGIDO EN ESTA RAMA.  
El Worker tributario emitía DTE y administraba CAF/folios, pero si `WORKER_KEY` faltaba aceptaba las rutas privadas. Ahora falla cerrado con 503 cuando falta la clave, mantiene únicamente `/health` público y CORS permite `X-Worker-Key`. El workflow de Cloudflare despliega `sii-worker` solo si existe `SII_WORKER_KEY`.

### P0-SEC-005 — Webhook social aceptaba una clave pública

**Estado:** CORREGIDO EN ESTA RAMA.  
`/webhooks/social` ya no acepta `PUBLIC_LEAD_KEY` ni cae a ella. `SOCIAL_WEBHOOK_KEY` es obligatorio; si falta, el endpoint responde 503 y no crea interacciones, clientes ni tareas.

### P0-SEC-006 — Firma de newsletter reutilizaba secretos públicos o fijos

**Estado:** CORREGIDO EN ESTA RAMA.  
La firma HMAC de confirmación/baja requiere `NEWSLETTER_SECRET` exclusivo. Se eliminaron los fallbacks a `PUBLIC_LEAD_KEY`, `AIRTABLE_TOKEN` y al literal conocido.

### P0-SEC-007 — Credenciales privilegiadas aún horneadas en el frontend estático

**Estado:** ABIERTO / arquitectura.  
El deploy todavía puede publicar credenciales con privilegios reales como `PORTAL_ADMIN_KEY`, `PRINTER_TUNNEL_TOKEN` y la clave de acceso del Worker SII. Quitarlas sin una sesión server-side rompería funciones actuales; por eso no se considera resuelto con ofuscación o localStorage.

**Objetivo final:** autenticar al usuario en backend y emitir permisos/tokens efímeros por capacidad. Ningún secreto maestro de portal, impresoras o tributación debe formar parte del HTML/JS público.

### P0-SEC-008 — Fallback de PAT Airtable en deploy

**Estado:** CORREGIDO EN ESTA RAMA (contención).  
GitHub Pages podía insertar `secrets.AIRTABLE` directamente en `index.html` si faltaba el proxy. `deploy.yml` ahora exige `PROXY_URL` y `PROXY_KEY`; sin ambos falla antes de publicar y no recibe el PAT como variable de entorno. Regresión: `tests/deploy-proxy-required.test.js`.

**Límite de esta corrección:** el proxy todavía recibe un `APP_KEY` conocido por el navegador y otros secretos administrativos aún se inyectan en la versión estática. Se necesita autenticación real de usuario y migrar las funciones privilegiadas al backend para cerrar P0-SEC-001 y P0-SEC-007.

### P0-SEC-009 — Proxy Airtable operaba sobre bases ajenas

**Estado:** CONTENIDO EN ESTA RAMA (no resuelve autorización).  
El Worker reenviaba rutas Airtable arbitrarias con el PAT del servidor. Una APP_KEY copiada del HTML y un Origin falsificado podían alcanzar cualquier otra base accesible al PAT. Ahora se restringen los endpoints de datos y metadata a la base TLS `app1YtD74AqiPWQhy` y se rechazan otros verbos.

**Riesgo pendiente:** cualquiera que copie APP_KEY todavía puede leer o modificar registros de la propia base TLS. La restricción NO equivale a inicio de sesión, RBAC ni control por fila; migrar a identidad firmada, roles server-side y rotar claves publicadas.

### P0-DATA-004 — Respuestas parciales o malformadas podían vaciar el CRM

**Estado:** CORREGIDO EN ESTA RAMA (regresión añadida).  
`airtableFetch` y `airtableFetchSince` aceptaban HTTP 200 sin un array `records` válido y trataban el resultado como `[]`. En una carga completa podían sustituir Pedidos por cero registros; cuando había más páginas que el máximo, se guardaba un snapshot truncado con etiqueta `scope:full`. Ahora el payload/paginación inválidos y los topes incompletos de tablas críticas provocan error antes de sustituir estado. La caché aumenta a v4 para no reutilizar snapshots anteriores.

**Riesgo pendiente:** las tablas auxiliares mantienen límites intencionales de consulta; ampliar la auditoría de sincronización, detección de eliminaciones y reconciliación en todas las tablas.

### P1-COT-001 — Emisión de correlativos desde copia local tras error remoto

**Estado:** MITIGADO EN ESTA RAMA.  
Si falla la lectura de Airtable, el correlativo de cotización/pedido ya no se calcula sobre una copia posiblemente obsoleta. La cotización manual tampoco ignora una lectura fallida de colisiones. Un error de red impide crear el documento y muestra el fallo; no se presenta como éxito.

**Riesgo pendiente:** dos equipos todavía pueden leer el mismo máximo a la vez. Hace falta reserva atómica del correlativo e idempotencia server-side; Airtable por sí solo no impone unicidad en estos campos.

### P1-PED-002 — Conversión de cotización duplicable o invisible tras crear

**Estado:** MITIGADO EN ESTA RAMA (regresión añadida).  
La conversión comprueba el vínculo Cotizaciones→Pedidos directamente en Airtable antes de escribir; falla cerrado si no puede verificarlo; bloquea dos conversiones simultáneas en la misma pestaña; limita reintentos POST a rechazos HTTP 422 confirmados; e incorpora el registro creado inmediatamente al estado local si falla el refresco posterior. El mismo criterio 422 se aplica a los pedidos de contratos recurrentes.

**Riesgo pendiente:** lectura y POST siguen siendo dos operaciones separadas entre navegadores. Cerrar con guard de mutación/idempotencia en backend y reconciliación por cotización, sin volver a publicar secretos administrativos.

### P0-DATA-005 — Facturas y auxiliares podían quedar fuera de una caché marcada como completa

**Estado:** CORREGIDO EN ESTA RAMA.  
Facturas no estaba en la lista de tablas críticas, y un error de Reportes/Proveedores/Monitor Sistema tampoco impedía guardar un snapshot con `scope:full`. Esto podía hacer que una sesión posterior mostrara una base aparentemente actualizada con datos financieros/auxiliares ausentes. Facturas ahora se reintenta como parte del núcleo; la caché solo se reemplaza cuando las siete tablas terminaron correctamente. Si falla una secundaria, la pantalla muestra `datos parciales`, conserva la caché íntegra anterior y no avanza el cursor incremental; si falla un full, el siguiente refresco vuelve a ser full. La versión de la caché pasa a v5 y se validan los seis arrays persistidos.

**Pendiente:** reconciliación multi-dispositivo de mutaciones simultáneas, edición offline con cola durable, e idempotencia transaccional de DTE.

### P0-SEC-010 — APP_KEY permitía borrar o modificar esquemas Airtable

**Estado:** CONTENIDO EN ESTA RAMA; falta autenticar usuarios.  
Aunque el proxy estaba limitado a la base TLS, reenviaba `PATCH` y `DELETE` de metadata usando un PAT de servidor que el navegador no debe controlar. Ahora solo permite leer la lista de tablas y realizar altas de un conjunto explícito de tablas y tipos de campos usados por el propio dashboard. Cada alta requiere validar contra la metadata autoritativa y rechaza duplicados y tablas no conocidas. Se añaden pruebas para bloquear modificaciones destructivas y validar el bootstrap.

**Riesgo que permanece:** APP_KEY es pública en el HTML: se pueden seguir ejecutando mutaciones de registros de la base TLS, y las altas de esquema legítimas siguen siendo alcanzables desde fuera del navegador con headers falsificados. Se requiere un sistema de sesiones firmado y autorización servidor por operación y tabla, además de un circuito administrativo separado para cambios de esquema.

### P1-SEC-011 — Auditor SEO podía seguir un open redirect fuera del dominio

**Estado:** CORREGIDO EN ESTA RAMA.  
`/seo-fetch` validaba el primer hostname (thelab.solutions) pero usaba `redirect:follow` en el Worker. Si una URL del sitio redirigía fuera del dominio, el backend la seguía sin revalidar destino, abriendo una ruta de SSRF y lecturas no acotadas. Ahora se ejecutan hasta cuatro solicitudes con `redirect:manual`, se validan todos los destinos (HTTPS, host exacto, sin credenciales ni puertos no estándar), se bloquean destinos externos/internos y se rechaza cualquier cuerpo mayor de 2 MiB incluso sin `Content-Length`.

**Regresión:** `tests/seo-proxy-ssrf.test.js` cubre redirecciones externas y a rangos privados, loop, respuesta pequeña legítima, cabecera grande y respuesta fragmentada grande.

### P0-BACKUP-001 — Respaldo semanal no abarcaba toda la base y fallaba abierto

**Estado:** CORREGIDO EN ESTA RAMA.  
El script semanal tenía una lista fija de 11 tablas y guardaba un JSON aunque algunas fallaran, si al menos otra devolvía registros. Ahora descubre las tablas existentes a través de la API de metadata de Airtable y recorre cada página con validación estructural y de `offset`. Si falla el esquema, ejecuta un fallback histórico etiquetado **INCOMPLETO**; si falta cualquiera de las tablas críticas o cualquier lectura falla, guarda un rescate cifrado si hay datos, genera un resumen de incidencias y marca el workflow con fallo. Los artefactos de recuperaciones parciales nunca se presentan como copias completas.

### P0-BACKUP-002 — Respaldo CRM en texto plano como artifact de repositorio público

**Estado:** CONTENIDO EN CÓDIGO; PENDIENTE DE CONFIGURAR SECRETO.  
El repositorio de GitHub es público y la workflow semanal subía `backup/*.json` sin cifrado. Los artefactos de repositorios públicos son accesibles a personas con lectura del repositorio; los archivos contienen datos sensibles de clientes. Ahora se requiere `BACKUP_ENCRYPTION_KEY` exclusivo, con 24+ caracteres, antes de leer/escribir la copia; cada backup se cifra en memoria con AES-256-GCM, clave scrypt, sal y nonce aleatorios. Solo se suben `backup/*.enc.json`, el resumen no se adjunta al artifact. Sin secret el job falla cerrado y solo deja resumen de bloqueo sin datos personales. Se incluye `scripts/decrypt-backup.mjs` para restauración privada local.

**Pendiente externo:** configurar un secreto aleatorio y estable `BACKUP_ENCRYPTION_KEY` en GitHub Actions, guardarlo fuera del repo, verificar una ejecución manual completa, y revisar/eliminar cualquier artefacto histórico en texto plano si existiera. No suponer que los artifacts históricos quedaron protegidos por cambiar la workflow.

### P1-FIN-008 — Folio sin año/tipo ocultaba facturas legítimas

**Estado:** CORREGIDO EN ESTA RAMA.  
El agregador financiero comparaba solo `fact` (folio) para sustituir líneas históricas por DTE de Airtable. El mismo folio de otro año o de otro tipo de documento (por ejemplo factura 33 y nota de crédito 61) eliminaba ingresos o cobranzas legítimas. Se concilia por `año|tipo|folio`; los registros históricos sin tipo se interpretan como factura 33, no como cualquier otro DTE. Se conservan todos los ítems del mismo documento histórico hasta que Airtable tenga el mismo DTE real. Folios vacíos y fechas ausentes no participan en la conciliación. Si el DTE carece de fecha válida se mantiene visible, pero no se asigna ficticiamente a enero del año en curso.

**Pruebas:** `tests/finanzas-dte-identidad.test.js` ejecuta las funciones financieras reales con documentos de años/tipos distintos, líneas múltiples, registros locales, fechas nulas y folios con ceros iniciales.

### P1-FIN-001 — Ventas manuales llamaban persistencia inexistente

**Estado:** CORREGIDO EN ESTA RAMA.  
`nvGuardar`, `nvEliminar` y `nvLimpiarTodas` llamaban una función inexistente después de mutar localStorage. El dato podía quedar guardado mientras la UI abortaba con una excepción. Ahora usan una única escritura local protegida y el mensaje declara que el dato queda en ese navegador. La migración a persistencia compartida sigue abierta.

### P1-FIN-002 — Costeo 3D multiplicaba extras varias veces

**Estado:** CORREGIDO EN ESTA RAMA.  
Extras flat se aplican una vez por trabajo; extras unitarios se multiplican una sola vez por la cantidad indicada. El costo total se calcula antes de distribuir costo/venta unitaria.

### P1-FIN-003 — Utilidad manual incluía IVA como ganancia

**Estado:** CORREGIDO EN ESTA RAMA.  
La utilidad ahora es venta neta menos costo. El IVA deja de inflar el margen.

### P1-FIN-004 — CSV no coincidía con la tabla de Facturas

**Estado:** CORREGIDO EN ESTA RAMA.  
La exportación reutiliza los montos normalizados de Airtable y neutraliza celdas que podrían convertirse en fórmulas al abrir el CSV.

### P1-FIN-005 — Health SII esperaba un RUT que el Worker ya no expone

**Estado:** CORREGIDO EN ESTA RAMA.  
El helper global `siiHeaders()` ya existía y CAF/folios/DTE lo reutilizan. El bug real estaba en la pantalla de diagnóstico: esperaba `rut_emisor`, campo retirado del health público por seguridad. Ahora usa `rut_emisor_configurado`, `cert_loaded` y `auth` sin exigir datos sensibles. Sigue abierto P0-SEC-007: la credencial maestra del Worker no debe terminar en un frontend estático.

### P1-FIN-006 — DTE repetido podía duplicar la fila Facturas

**Estado:** MITIGADO EN ESTA RAMA.  
Al materializar la respuesta del Worker se busca tipo DTE + folio en el estado autoritativo y se hace PATCH si existe. Falta idempotencia server-side y conciliación durable para cerrar completamente el riesgo.

### P1-FIN-007 — Vencimientos desfasados al cambiar horario de verano

**Estado:** CORREGIDO EN ESTA RAMA.  
`finVenc` sumaba `plazo*86400000` a una fecha anclada a medianoche. Al cruzar cambios de horario en Chile, el resultado podía quedar a las 23:00 del día anterior o 01:00 del día esperado. El cálculo ahora usa `Date#setDate` para sumar días de calendario y mantener la medianoche local.

**Regresión:** `tests/finanzas-vencimiento-local.test.js` ejecuta casos de entrada/salida del horario de verano con `TZ=America/Santiago`.

## Backlog confirmado por pruebas TODO existentes

La repo ya declara deuda técnica explícita que se incorpora a esta auditoría:

- **Web/Ads:** restaurar título SEO tras diagnóstico; sacar credenciales WordPress/Ads de localStorage; no exponer webhooks/keys de Make; ordenar correctamente creación/cola; verificar escritura real antes de mostrar éxito.
- **Correo:** validar To/CC/BCC y cantidad de destinatarios; restringir From; bloquear recursos remotos por defecto; sanitizar HTML/URLs; detectar frontend/backend desfasados.
- **Finanzas:** await/rollback en ventas; persistencia compartida de libro/caja/pagos/préstamos; IVA basado en documentos tributarios; DTE idempotente y reconciliable.
- **Visual AI:** sandbox mínimo, referrerpolicy, noopener, postMessage con allowlist, timeout y retry.
- **Newsletter:** baja firmada y personalizada; List-Unsubscribe; consentimiento para destinatarios extra; evidencia de envío.
- **Proveedores:** lifecycle completo de OC; supplierId/moneda/unidad/IVA/vigencia; reputación por entregas reales; validar URLs y contactos importados.
- **Remuneraciones:** versionar comisiones; política de comisión ganada/reversa; neto tributario real; separar cotizaciones vencidas.
- **Equipo:** validar rangos de fecha; rollback de disponibilidad; semántica correcta de Google Calendar.
- **Redes:** upsert de métricas; dedupe de leads; allowlist de URLs; tickets/SLA para quejas.
- **Reportes:** CAC por adquisiciones reales; gasto por período; orden determinista; evitar duplicados semanales.
- **Oficina:** healthcheck independiente; incidencias trazables; política de retención/privacidad.

## Orden de ejecución

**Fase 1 — Contención P0:** seguridad, secretos, gasto IA, autorización, integridad de datos y backups.  
**Fase 2 — Núcleo comercial:** Cotizaciones → Pedidos → Facturas/Finanzas → Clientes.  
**Fase 3 — Producción:** Máquinas → cola → slicer → simulación.  
**Fase 4 — Operación:** Correo, calendario, proveedores, equipo, Drive/DTE.  
**Fase 5 — Growth:** Web, Ads, redes, newsletter, reportes.  
**Fase 6 — Calidad transversal:** responsive, accesibilidad, rendimiento, PWA, CI/CD y observabilidad.

## Regla de cierre de cada sección

Una sección no se considera auditada solo porque “se ve bien”. Debe tener:

- mapa de datos y dependencias;
- invariantes de negocio documentadas;
- permisos revisados;
- errores y estados vacíos/cargando/offline definidos;
- mutaciones idempotentes o con rollback;
- pruebas de regresión para bugs encontrados;
- comportamiento desktop y móvil revisado;
- métricas/alertas para fallas silenciosas;
- lista explícita de riesgos que dependan de servicios externos.
