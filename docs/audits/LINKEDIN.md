# Auditoría LinkedIn — 2026-10-02

## Alcance

Revisión de la lógica LinkedIn incorporada en **Redes Sociales**, incluyendo:

- `js/linkedin.js` — prospección outbound, scoring, estados, follow-up y conversión a CRM.
- `lead-worker/src/index.js` — inbound desde LinkedIn Lead Gen / Make / Zapier.
- `LinkedIn_Prospects` + `Clientes` + `Agent_Queue`.
- Seguridad de webhook, deduplicación, idempotencia y trazabilidad.

La tabla `LinkedIn_Prospects` estaba vacía al momento de la auditoría, por lo que todavía no existe evidencia real de uso outbound en producción. La revisión se basa en lógica, schema y pruebas automatizadas.

## Hallazgos y estado

### P0 — El webhook de LinkedIn aceptaba una clave pública

**Problema:** `/webhooks/linkedin` aceptaba `X-Public-Lead-Key` y usaba `PUBLIC_LEAD_KEY` como fallback. Esa clave viaja en la web pública y no puede autorizar una ruta que crea Clientes, tareas, emails y avisos.

**Estado:** CORREGIDO.

Ahora:
- exige `LINKEDIN_WEBHOOK_KEY`;
- si el secreto no está configurado responde **503**;
- una clave pública ya no autoriza la ruta.

### P1 — Origen inbound inconsistente con Airtable

**Problema:** el Worker escribía `Origen lead = linkedin`, mientras la opción real del CRM es `LinkedIn`. Esto podía crear una opción duplicada por typecast o romper la atribución que filtra por el valor canónico.

**Estado:** CORREGIDO.

`origenLabel("linkedin")` devuelve `LinkedIn`.

### P1 — Reintentos de Make/Zapier podían duplicar tareas y respuestas

**Problema:** el Cliente se deduplicaba por email/teléfono, pero el mismo webhook repetido podía crear otra fila en `Agent_Queue`, volver a enviar la auto-respuesta y repetir procesamiento.

**Estado:** CORREGIDO / CONTENIDO.

- Se acepta `linkedinLeadId`.
- Se usa KV `RL` con una clave de idempotencia por evento durante 30 días.
- El mismo `linkedinLeadId` devuelve el Cliente/queue previamente creado.
- El evento inbound se refleja en `LinkedIn_Prospects` y se actualiza por `LinkedIn Lead ID`.

**Límite:** KV no es un lock transaccional global. Dos solicitudes idénticas que entren exactamente al mismo tiempo aún tienen una ventana de carrera pequeña. Para garantía fuerte se necesitaría un Durable Object o una operación server-side serializada.

### P1 — El funnel tenía estados que nunca se utilizaban

**Problema:** existía `Por contactar`, pero el dashboard saltaba directamente de `Calificado` a `Contactado`. También faltaban acciones claras para `Oportunidad` y `Descartado`.

**Estado:** CORREGIDO.

Flujo operativo:
`Descubierto → Analizado/Calificado → Por contactar → Contactado → Respondió → Oportunidad → Cliente`

También se puede descartar un prospecto sin contaminar el CRM.

### P1 — Era posible convertir un prospecto sin calificar

**Problema:** **→ Clientes** aparecía incluso en `Descubierto` y `Analizado`, contradiciendo el objetivo de usar `LinkedIn_Prospects` como staging.

**Estado:** CORREGIDO.

La conversión solo se permite en:
- Calificado
- Por contactar
- Contactado
- Respondió
- Oportunidad

La función también valida el estado, no depende solo de ocultar el botón.

### P1 — Dedupe outbound demasiado débil

**Problema:** URLs como:
- `linkedin.com/in/persona`
- `www.linkedin.com/in/persona/?trk=...`
- subdominios regionales

podían considerarse personas distintas. Tampoco se comparaba teléfono.

**Estado:** CORREGIDO.

Ahora:
- la URL se canoniza a `https://www.linkedin.com/<path>`;
- se eliminan query/hash/trailing slash;
- email se normaliza;
- teléfono se compara por los últimos 9 dígitos;
- se mantiene fallback nombre + empresa;
- antes de convertir se refresca `Clientes` desde Airtable.

### P1 — Doble clic podía iniciar conversiones simultáneas

**Problema:** no había lock local de conversión/análisis/estado.

**Estado:** CORREGIDO.

Se añadieron guards `analyzeBusy`, `convertBusy` y `statusBusy`. Si el prospecto ya está convertido y vinculado, se abre el Cliente existente en vez de crear otro.

**Límite:** esta protección es por navegador. Dos dispositivos distintos aún requieren serialización server-side para una garantía absoluta.

### P2 — Follow-up guardado pero sin utilidad operativa

**Problema:** `Follow-up` y `Próximo seguimiento` se escribían, pero el panel no mostraba claramente el vencimiento ni permitía reutilizar el texto.

**Estado:** CORREGIDO.

- muestra la fecha de seguimiento;
- marca **VENCIDO**;
- prioriza vencidos al ordenar;
- permite copiar el follow-up;
- al registrar respuesta limpia el seguimiento pendiente.

### P2 — Una respuesta IA malformada podía dejar score 0

**Problema:** si `LINKEDIN_AGENT` no devolvía `SCORE_B2B` válido, se guardaba 0 y el prospecto quedaba como analizado.

**Estado:** CORREGIDO.

Una respuesta sin score válido se trata como error y no pisa el prospecto con un análisis inválido.

### P2 — Inbound no quedaba en la misma memoria de LinkedIn

**Problema:** los Lead Gen Forms iban directo a `Clientes + Agent_Queue`, mientras outbound vivía en `LinkedIn_Prospects`. La interfaz mostraba ambos, pero la memoria no era realmente unificada.

**Estado:** CORREGIDO.

Un inbound exitoso crea/actualiza también `LinkedIn_Prospects` con:
- `Fuente = Lead Gen Form`
- `Estado = Cliente`
- vínculo a `Cliente`
- `LinkedIn Lead ID`
- campaña y datos de contacto disponibles.

### P2 — Payload inbound vacío podía avanzar demasiado

**Problema:** el endpoint no exigía información mínima de identidad antes de llamar al núcleo de persistencia.

**Estado:** CORREGIDO.

Ahora requiere al menos uno entre nombre, empresa, email o teléfono.

## Aspectos que siguen abiertos

### A. Conversión outbound no es transaccional entre dispositivos

El refresh de Clientes + dedupe + locks locales reduce mucho los duplicados, pero dos computadores podrían intentar convertir simultáneamente el mismo prospecto.

**Mejora futura:** mover `linkedinConvertToClient` a una ruta server-side con idempotency key y serialización.

### B. RBAC de frontend y Cloudflare Access no están alineados

El frontend permite Redes a roles como `marketing`/comercial, pero las tablas sociales y `LinkedIn_Prospects` siguen `admin-only` en el proxy Access. Dependiendo del mapeo real de emails a roles de Access, un usuario podría ver el panel pero recibir 403 al guardar.

**Mejora futura:** definir un rol server-side de marketing o permisos explícitos por tabla/campo, en vez de ampliar acceso general.

### C. Descubrimiento sigue siendo manual

La búsqueda abre LinkedIn y el usuario elige los perfiles. Es deliberado: no hay scraping ni automatización de cuentas personales.

**Mejora futura:** si se contrata Sales Navigator o una integración oficial compatible, usar sus filtros/señales para descubrir prospectos, manteniendo aprobación humana para contacto personal.

### D. Métricas comerciales aún son básicas

Faltan métricas por campaña/identidad/segmento:
- tasa Contactado → Respondió;
- Respondió → Oportunidad;
- Oportunidad → Cliente;
- tiempo promedio hasta respuesta;
- follow-ups vencidos;
- revenue originado en prospección LinkedIn.

Estas métricas deberían construirse sobre fechas/eventos reales, no inferirse solo desde el estado actual.

## Lógica objetivo después de esta auditoría

### Outbound
`Buscar → Guardar staging → Analizar IA → Calificado → Por contactar → Contactado → Follow-up → Respondió → Oportunidad → Cliente`

### Inbound
`LinkedIn Lead Gen → Make/Zapier → webhook autenticado → idempotencia → Cliente + Agent_Queue + LinkedIn_Prospects → LINKEDIN_AGENT → seguimiento comercial`

### Principio de diseño

`LinkedIn_Prospects` es una **zona de pre-CRM y trazabilidad**. No debe convertirse en un segundo CRM. `Clientes` sigue siendo la fuente definitiva una vez que existe una oportunidad comercial real.
