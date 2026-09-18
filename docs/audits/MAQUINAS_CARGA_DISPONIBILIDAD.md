# Auditoría — Carga de producción y disponibilidad semanal

Fecha: 18 de septiembre de 2026

## Objetivo

Revisar la fiabilidad de las vistas **Carga de producción** y **Disponibilidad semanal** de Máquinas, y dejar ambas pantallas utilizables para operación diaria sin confundir estimaciones, agenda manual y estado físico real.

## Hallazgos

### 1. Las “horas de trabajo” se inferían desde el valor en pesos del pedido

Cuando un pedido no tenía `Horas máquina reales`, la vista calculaba horas usando el monto neto del pedido:

- Carga de producción: aproximadamente una hora por cada $25.000 netos.
- Modal del calendario: aproximadamente una hora por cada $15.000 netos.

El precio de venta no es una medida técnica de tiempo de impresión. Materiales, margen, terminaciones, diseño y otros costos pueden cambiar el valor sin cambiar las horas de máquina.

**Corrección:** la nueva vista no usa dinero para estimar horas. Las horas planificadas provienen únicamente de trabajos MachineOps: `ciclos × minutos por ciclo`. Las horas del calendario son sólo las horas explícitamente registradas.

### 2. “Disponible” significaba en muchos casos “no hay evento manual”

La vista semanal consideraba libre un día si no existía un registro en `Maquinas_Eventos`. Eso no comprobaba que la impresora estuviera realmente libre.

**Corrección:**

- **Hoy** sólo se muestra **Libre ahora** cuando hay telemetría reciente (<60 s), estado técnico libre y la máquina está administrativamente disponible.
- Sin telemetría reciente se muestra **Sin dato actual**.
- En fechas futuras, una celda vacía se muestra como **Sin reserva**, no como “Libre”.
- Una impresión terminada se muestra como **Terminó impresión · retirar/QA**, no como libre automáticamente.

### 3. El porcentaje de “utilización semanal” no medía utilización real

La métrica dividía cantidad de días con algún evento por `máquinas × 7 días`. Un evento de una hora y uno de 24 horas ocupaban lo mismo. Además, ausencia de evento se interpretaba como capacidad libre.

**Corrección:** se elimina ese porcentaje. La agenda ahora informa datos observables:

- reservas registradas;
- mantenciones;
- horas explícitamente registradas;
- libres confirmadas ahora;
- imprimiendo ahora;
- máquinas sin telemetría.

### 4. La asignación de pedidos duplicaba la planificación técnica

El campo `Máquina asignada` de Pedidos sólo permite una impresora por pedido. MachineOps, en cambio, permite dividir un pedido en varios trabajos y varias impresoras.

La vista anterior podía mostrar un pedido “asignado” aunque:

- no existiera ningún trabajo de impresión;
- el pedido estuviera repartido en varias impresoras;
- la planificación MachineOps indicara otra impresora;
- no existiera cola durable.

**Corrección:** el campo antiguo queda tratado sólo como referencia administrativa. La carga real se deriva de trabajos MachineOps. Se detectan y muestran conflictos entre ambos modelos.

### 5. “Asignar a la más libre” no comprobaba compatibilidad suficiente

La sugerencia anterior priorizaba la menor suma de horas estimadas y ETA, pero podía usar estados sin telemetría y no conocía necesariamente volumen, material, boquilla o distribución técnica del pedido.

**Corrección:** el botón de sugerencia sólo reutiliza una máquina cuando ya existe una planificación MachineOps inequívoca. Si el pedido no tiene trabajos, abre el flujo de planificación para crear una ficha técnica antes de decidir impresora. Si el pedido está distribuido en varias impresoras, no lo reduce a una sola.

## Fuentes de verdad

| Dato | Fuente | Cómo se presenta |
| --- | --- | --- |
| Estado actual de impresora | Moonraker / telemetría | Confirmado sólo con lectura <60 s |
| Trabajo planificado | MachineOps | Estimación técnica por ciclos y min/ciclo |
| Cola durable | Farm Controller | Confirmada sólo con sincronización reciente |
| Reserva futura | Maquinas_Eventos | Reserva manual registrada, no disponibilidad física |
| Horas semanales | Maquinas_Eventos.tiempo | Sólo horas explícitamente registradas |
| Asignación antigua | Pedidos.Máquina asignada | Referencia administrativa, no ejecución |

## Nueva estructura visual

### Carga de producción

La pantalla ahora comienza con tres indicadores de evidencia:

1. Planificación MachineOps.
2. Telemetría reciente.
3. Farm Controller.

Luego muestra:

- trabajos activos;
- horas planificadas desde parámetros técnicos;
- pedidos sin trabajo;
- impresiones confirmadas ahora;
- cola durable confirmada;
- conflictos de asignación.

Las impresoras sin carga quedan contraídas para reducir ruido. Los pedidos sin trabajo aparecen en una sección **Pedidos por preparar** con acceso directo a crear un trabajo MachineOps.

### Agenda semanal de máquinas

La antigua **Disponibilidad semanal** pasa a una agenda basada en evidencia:

- **Libre ahora**: sólo telemetría reciente.
- **Imprimiendo / Pausada / No disponible**: estado técnico actual.
- **Reservada / Mantención**: evento manual guardado.
- **Sin reserva**: futuro sin evento; no significa “libre”.
- **Sin dato actual**: telemetría insuficiente.

El selector de semanas muestra cantidad de reservas y horas registradas, no un porcentaje de utilización inventado.

## Protecciones de regresión

Se agregan pruebas para impedir que vuelva a ocurrir:

- estimar horas desde el valor del pedido;
- considerar libre un día futuro sin reserva;
- considerar libre hoy con telemetría vencida;
- ignorar bloqueos administrativos;
- esconder conflictos entre MachineOps y la asignación antigua;
- dejar el nuevo módulo fuera de la auditoría CI de Máquinas.
