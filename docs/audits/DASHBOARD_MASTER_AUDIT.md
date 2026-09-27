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
| 03 | Datos, Airtable, caché y sincronización | P0 | PENDIENTE | snapshots parciales, paginación, dedupe, rollback, conflictos |
| 04 | Cotizaciones | P1 | PENDIENTE | cálculo, estados, aprobación→pedido, documentos, edición |
| 05 | Pedidos | P1 | PENDIENTE | lifecycle, pagos, despacho, tarjetas/tabla, integridad de relaciones |
| 06 | Finanzas y Facturas | P0/P1 | PENDIENTE | revenue, saldos, IVA, DTE, caja, idempotencia |
| 07 | Clientes / CRM / Recompras | P1 | PENDIENTE | ownership, historial, cadencias, acciones y trazabilidad |
| 08 | Máquinas / granja / cámaras | P0/P1 | PENDIENTE | bridge, auth, telemetría, estados, recuperación, falsas alarmas |
| 09 | Cola / trabajos / producción 3D | P1 | PENDIENTE | lifecycle durable, asignación, reimpresión, concurrencia |
| 10 | Slicer / simulación / Visual AI | P1/P2 | PENDIENTE | fiabilidad, permisos, iframe, costo IA, errores |
| 11 | Calendario / Drive / documentos | P1 | PENDIENTE | OAuth, sincronización, fechas, permisos, archivos |
| 12 | Correo / notificaciones / WhatsApp | P0/P1 | PENDIENTE | remitentes, sanitización, tracking, rate limit, evidencia de envío |
| 13 | Proveedores / compras / OC | P1 | PENDIENTE | lifecycle, precios, moneda/IVA, entregas, validación |
| 14 | Equipo / remuneraciones | P1 | PENDIENTE | comisiones, metas, vigencia, disponibilidad, persistencia |
| 15 | Web / SEO / Google Ads | P0/P1 | PENDIENTE | credenciales, mutaciones, rollback, métricas, secretos |
| 16 | Redes sociales / newsletter | P1 | PENDIENTE | consentimiento, dedupe, métricas, enlaces, publicaciones |
| 17 | Overview / Reportes / CEO / Oficina | P1 | PENDIENTE | KPIs, fuente de verdad, ventanas temporales, healthchecks |
| 18 | Navegación / UI / responsive | P2 | PENDIENTE | alineación, modales, densidad, consistencia TLS, móvil |
| 19 | Accesibilidad | P2 | PENDIENTE | teclado, focus, contraste, roles, lectores |
| 20 | Rendimiento / PWA / caché | P1/P2 | PENDIENTE | carga inicial, SW, stale data, polling, memoria |
| 21 | CI/CD / backups / observabilidad | P0/P1 | PENDIENTE | tests, deploy, rollback, backups, alertas, recovery |

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
