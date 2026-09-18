# Auditoría de confiabilidad y usabilidad — Máquinas / Centro inteligente

Fecha: 2026-09-18

## Alcance

Se auditó la zona diaria de **Máquinas → Hoy**, especialmente:

- Salud y fiabilidad por impresora.
- CFS y filamento físico.
- Incidentes recientes.
- KPIs inferiores de operación.
- Persistencia y procedencia de los datos usados por esos bloques.

El objetivo no fue agregar más métricas, sino reducir afirmaciones que parecían más precisas de lo que realmente permitían los datos.

## Hallazgos

### 1. El porcentaje de “fiabilidad” tenía falsa precisión

El cálculo anterior mezclaba trabajos de MachineOps, incidentes eléctricos de los últimos 30 días, alertas de mantención y estado actual online/offline.

Si una máquina no tenía trabajos registrados, el éxito arrancaba en **100%**. La disponibilidad también arrancaba en **100%** y se corregía con una heurística. Por lo tanto un “100%” no significaba que existiera historial suficiente para afirmar 100% de fiabilidad.

### 2. Existía una fuente durable mejor que no se estaba usando

El dashboard ya dispone de:

- `PrinterHistory`, sincronizado con `/farm/production`, con odómetro de impresiones completadas y cierres no completados.
- `FarmHealth`, que prueba las impresoras desde el Farm Controller y entrega estado central, última lectura y fallos consecutivos.

La vista de fiabilidad no estaba usando esas fuentes como evidencia principal.

### 3. Las cancelaciones automáticas se veían como incidentes confirmados

Una transición de impresión a `cancelled` generaba automáticamente un “Incidente: Impresión cancelada”. Eso es útil como **evento**, pero una cancelación puede ser intencional y no necesariamente una falla de la máquina.

Además, la deduplicación automática era de sólo 5 minutos. En una lista larga, eventos repetidos daban una sensación de fallas confirmadas aunque nadie las hubiera validado.

### 4. CFS mezclaba “sin lectura” con una percepción de falla

Las K2/K2 Plus se incluían siempre en el bloque CFS. Si no había una lectura física reciente, aparecía “Sin lectura CFS”, sin distinguir entre CFS realmente desconectado, máquina sin CFS, telemetría aún no recibida o telemetría antigua.

### 5. “Máquinas no listas” era ambiguo

El KPI inferior intentaba condensar disponibilidad operacional, estado manual y telemetría en una sola cifra. No explicaba la fuente ni la frescura y por eso no era una cifra adecuada para tomar decisiones.

## Cambios aplicados

### Estado y evidencia por impresora

Se elimina el porcentaje global de fiabilidad como dato principal.

Cada máquina muestra ahora:

- **Operativa ahora / Mantención pendiente / Requiere atención / Sin datos actuales**.
- nivel de confianza de datos (**alta / media / baja**).
- fuente del historial (**Historial central / Caché local / Trabajos registrados**).
- impresiones completadas y cierres no completados.
- estado reciente de FarmHealth.
- incidentes **confirmados** abiertos.
- alertas de mantención.

La salud actual sólo se afirma cuando hay telemetría/FarmHealth reciente.

### Incidentes

Se separan dos conceptos:

1. **Evento automático**: detectado por telemetría, todavía no confirmado.
2. **Incidente confirmado**: validado por un operador o registrado manualmente.

Los eventos automáticos tienen acciones explícitas: **Confirmar falla** y **Descartar**.

Sólo los incidentes confirmados influyen en el diagnóstico de la máquina.

Los eventos automáticos de más de 24 horas dejan de aparecer como tareas pendientes y pasan al historial. No se borran.

La deduplicación de eventos de telemetría sube a 30 minutos para reducir repeticiones por oscilaciones/relecturas del estado.

### CFS / filamento físico

El bloque pasa a ser un detalle técnico contraíble.

Estados: CFS conectado, Filamento detectado, Sin filamento, CFS no detectado y Sin dato reciente.

La falta de lectura se etiqueta explícitamente como **dato desconocido**, no como falla.

### KPIs diarios

Se reemplaza “Máquinas no listas” por **Telemetría reciente X/N**, una métrica factual basada en lecturas físicas de menos de 60 segundos.

El resumen diario queda compuesto por: imprimiendo ahora, trabajos abiertos, esperando QA, sin máquina, carga pendiente y telemetría reciente.

## Principio de confiabilidad adoptado

La interfaz ya no debe transformar ausencia de datos en un resultado positivo.

- Sin evidencia suficiente → **Sin datos actuales**.
- Evento automático → **Por confirmar**.
- Falla validada → **Incidente confirmado**.
- Dato físico antiguo → **Sin dato reciente**.

Esto prioriza trazabilidad sobre una apariencia de exactitud.
