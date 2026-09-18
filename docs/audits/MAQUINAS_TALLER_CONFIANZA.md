# Auditoría — Máquinas / Taller

Fecha: 18 de septiembre de 2026

## Objetivo

Revisar la fiabilidad de la pantalla Taller y dejarla utilizable para operación diaria sin mezclar mediciones físicas, registros manuales y estimaciones.

## Hallazgos y correcciones

### Estructura
Taller mostraba ocho áreas apiladas a la vez: capacidad, perfiles, laminador, materiales, mantenimiento, seguridad, analítica y automatización. Ahora abre con un resumen único de confianza y acciones. Operación física agrupa Materiales, Mantención, Seguridad y Capacidad; las herramientas avanzadas agrupan Perfiles, Laminador, Analítica y Configuración. Al entrar a una herramienta se abre sólo ese módulo.

### Capacidad
El simulador alteraba los minutos por ciclo mediante multiplicadores internos por modelo, contaba QA como ocupación y podía sumar una impresión activa completa más su ETA. También permitía simular sin dimensiones. Ahora X/Y/Z son obligatorios, los minutos ingresados se respetan literalmente, QA no ocupa impresora y una impresión activa usa ETA restante cuando existe. La salida se etiqueta como escenario y no como promesa contractual.

### Materiales
El antiguo KPI Disponible sumaba el stock remanente aunque parte estuviera reservada. Ahora se separan Stock registrado, Reservado y Libre = registrado − reservado. La interfaz declara que el inventario es administrativo y que no existe una balanza física conectada.

### Seguridad ambiental
Valores ausentes podían convertirse en cero y parecer normales. Ahora temperatura, humedad y VOC ausentes permanecen desconocidos. Una lectura manual exige las tres métricas y rangos razonables. La fuente sensor/manual y la antigüedad se muestran explícitamente. La cámara se valida por impresora en preflight, no con la existencia de alguna cámara en la flota.

### Mantención
El historial de impresión dispone de backend durable mediante PrinterHistory, pero la tabla no indicaba si estaba usando datos centrales o locales. Además, el log elegía remoto o local en vez de fusionarlos: una mantención guardada localmente durante un fallo de Airtable podía quedar oculta después de recargar. Ahora remoto + local se fusionan, los fallos de sincronización quedan visibles, y la tabla declara Historial central reciente / Caché local / Historial sin confirmar. Sin un servicio base se muestra 'sin mantención base registrada' en lugar de afirmar vencimiento. También se eliminó la etiqueta 'subutilizada' basada sólo en falta de datos.

### Perfiles
Un perfil podía quedar aprobado aun sin modelo, material, boquilla, parámetros o altura de capa. Ahora la aprobación exige esos datos y confirmación humana. Aprobado significa revisión humana registrada, no certificación automática de acabado o tolerancias. Perfiles experimentales requieren confirmación antes de usar; deprecados se bloquean.

### Analítica
Sin muestra, éxito QA, precisión ETA y tasa por impresora podían mostrarse como 100%. Ahora se muestra '—'. Precisión ETA y horas reales usan sólo tiempos medidos. Costo producción se presenta como costo modelado. La contribución se llama Contribución asignada y se explica que distribuye venta neta entre trabajos 3D por minutos, por lo que no equivale a margen contable.

## Fuentes de verdad

| Dato | Fuente | Tratamiento |
| --- | --- | --- |
| Estado actual | Moonraker / telemetría | Físico y reciente cuando <60 s |
| Historial / odómetro | Farm Controller / PrinterHistory | Durable con sync central reciente; fallback local etiquetado |
| Mantención | Registros + horas de impresión | Registrado; requiere servicio base para calcular desde último servicio |
| Material | Inventario MachineOps | Registrado, no pesado físicamente |
| Reservas | Trabajos MachineOps | Calculadas desde gramos de trabajos abiertos |
| Ambiente | Sensor o lectura manual | Fuente y edad visibles |
| Cámara | Configuración por impresora | Validada por máquina en preflight |
| Capacidad | Simulación | Estimada, no promesa |
| Perfil aprobado | Revisión humana | No certifica acabado/tolerancias |
| Costos | Configuración MachineOps | Modelo de costo |
| Contribución | Venta neta distribuida por minutos | Estimación analítica |

## Resultado de UX

La pantalla inicial responde primero qué requiere acción, qué fuentes están confirmadas, cuánto material libre registrado existe, cómo está el ambiente y cuántos perfiles están listos. Las herramientas detalladas se abren sólo cuando se necesitan.