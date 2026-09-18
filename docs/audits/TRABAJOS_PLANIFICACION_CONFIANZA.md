# Auditoría — TRABAJOS / Centro de planificación

Fecha: 18 de septiembre de 2026

## Objetivo

Revisar la fiabilidad real de la pantalla **TRABAJOS** de Máquinas y simplificarla para uso diario. El criterio de esta auditoría es no presentar una estimación, un estado local o una recomendación como si fueran evidencia física de ejecución.

## Hallazgos

### 1. “En cola” mezclaba dos conceptos diferentes

MachineOps usaba el estado `en_cola` para indicar que un trabajo estaba preparado en el dashboard. Sin embargo, ese cambio de estado no crea por sí solo un trabajo en la cola durable del Farm Controller.

La cola durable real vive en `/farm/queue` y su integración expone `FarmQueue.status()`. Por eso la interfaz anterior podía hacer pensar que un trabajo ya estaba persistido para ejecución cuando sólo estaba planificado localmente.

**Corrección:** el estado visible pasa a llamarse **Lista para iniciar**. La interfaz distingue explícitamente:

- planificación del dashboard;
- telemetría física reciente;
- cola durable confirmada por Farm Controller.

Sólo se muestra **Controller confirmado** cuando existe evidencia reciente del controller y un trabajo coincidente por impresora + archivo.

### 2. La planificación automática aceptaba estados técnicos no confirmados

`machineOperational()` descartaba errores conocidos, pero un estado vacío, `connecting`, `unknown` o una lectura antigua podía no quedar excluido de la planificación.

**Corrección:** una impresora sólo es candidata automática cuando tiene telemetría de menos de 60 segundos y un estado técnico conocido. La falta de datos ya no se interpreta como disponibilidad.

### 3. La vista mezclaba operación diaria e historial

La tabla mostraba trabajos activos y cerrados juntos. Además, acciones, material, pedido, producción y estado competían en una tabla ancha.

**Corrección:** los trabajos activos son ahora el foco principal. Cada tarjeta muestra:

- trabajo y pedido;
- máquina;
- producción;
- material;
- duración estimada;
- próximo paso recomendado;
- evidencia disponible;
- acciones con texto.

El historial cerrado queda contraído por defecto, salvo cuando una búsqueda o filtro lo necesita.

### 4. El gráfico de carga parecía más exacto de lo que era

La carga por máquina representaba tiempos estimados de MachineOps, pero el texto “en cola” podía confundirse con ejecución real. Además, una máquina vacía usaba un mínimo artificial de 1 minuto.

**Corrección:** ahora se llama **Plan estimado por impresora**, declara que no garantiza ejecución, muestra telemetría reciente y, separadamente, la cantidad de trabajos durables confirmados por el Controller. Una máquina vacía muestra 0 minutos reales de planificación.

## Fuentes de verdad

| Dato | Fuente | Tratamiento |
| --- | --- | --- |
| Ficha y planificación del trabajo | MachineOps | Estado administrativo; no implica ejecución física |
| Estado actual de impresora | Moonraker / `_printerStatus` | Se considera confiable para planificación sólo con lectura < 60 s |
| Cola durable | Farm Controller / `FarmQueue.status()` | Se presenta como confirmada sólo con sincronización < 30 s |
| Inicio manual | Preflight + respuesta HTTP de Moonraker | El trabajo cambia a imprimiendo tras respuesta exitosa |
| Fin/cancelación | Transición de telemetría | Lleva a QA o fallo según el evento observado |
| CFS físico | Inventario físico del taller | Sólo K1 #1 y K2 Plus |

## Qué sigue siendo una estimación

Las horas pendientes, duración por trabajo y orden de bloques dependen de los minutos/ciclos registrados. Son planificación, no una promesa de término. El dashboard ahora los etiqueta como estimaciones.

Un trabajo creado manualmente en MachineOps conoce el **nombre del G-code**, pero no necesariamente posee los bytes del archivo. Por eso no se convierte silenciosamente en una cola durable del Farm Controller. Para afirmar que existe una cola durable debe existir evidencia del Controller.

## Protecciones de regresión

Se agregaron pruebas para verificar que:

- la planificación exige telemetría reciente;
- no se confunde planificación local con cola durable;
- la UI explica explícitamente esa diferencia;
- una máquina sin trabajos no recibe un minuto ficticio;
- la configuración física de CFS continúa limitada a K1 #1 y K2 Plus.
