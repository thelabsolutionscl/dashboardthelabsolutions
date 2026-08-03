# Auditoría de OFICINA VIRTUAL

Fecha: 2026-08-02

## Alcance

Se revisaron:

- La pestaña Oficina Virtual y sus vistas Tarjetas, Planta y Oficina 3D.
- El modelo de agentes IA, automatizaciones e impresoras.
- El feed de actividad, búsqueda, detalle y copia de ejecuciones.
- Los KPIs, alertas, salud, gráficos, ranking y resumen diario.
- La lectura de `Agent_Log`, `Agent_Queue`, `Automations`, `Maquinas` e `Inventario`.
- El polling, caché, telemetría en vivo y relación con el módulo Máquinas.
- Las acciones con RBAC, fullscreen, exportación y accesibilidad.

## Flujo observado

1. La Oficina une ejecuciones locales de `AGENT_LOG` con hasta 100 filas remotas de `Agent_Log`.
2. Construye un modelo para agentes IA, automatizaciones e impresoras.
3. Deriva presencia y estado desde actividad reciente, campos de Airtable y telemetría del navegador.
4. Presenta el mismo modelo en tarjetas, planta 2D y escena 3D.
5. Calcula KPIs, alertas, salud, tendencias, rankings y feed.
6. Permite abrir una ejecución completa, copiar resultados, ejecutar agentes y navegar hacia módulos relacionados.
7. Actualiza el modelo cada 45 segundos y muta relojes/progreso cada 20 segundos.

## Controles confirmados

- `renderOficina()` evita renders solapados y conserva un render pendiente.
- El polling se pausa cuando la página está oculta y se limpia al salir.
- La conexión admite token local o proxy.
- Existen cachés cortas con invalidación manual.
- La escena restringe URLs de imágenes y utiliza etiquetas ARIA.
- El modo de impresoras prioriza `_printerStatus` cuando existe.
- Las alertas respetan RBAC antes de ofrecer navegación a otra pestaña.
- La consulta del feed se escapa antes de mostrarla.
- La escena 3D tiene cámara, fullscreen, reducción de trabajo fuera del viewport y soporte táctil.
- El resumen diario y la exportación reutilizan el modelo actual.

## Hallazgos

### Críticos

1. **La analítica de 7, 14 y 30 días usa una muestra máxima de 100 logs.**
   Rankings, gráficos, rachas y “Empleado del mes” pueden representar solo una fracción del período. Además, cada navegador añade sus logs locales, por lo que dos usuarios pueden ver resultados distintos.

2. **La cola no representa necesariamente tareas pendientes.**
   El KPI usa `_agentQueue.length` o el total de hasta 200 filas de `Agent_Queue`, sin filtrar por estado procesable ni paginar. Registros completados o fallidos pueden seguir apareciendo como “En cola”.

3. **“Trabajando” no equivale a una ejecución en curso.**
   Si no está en `_ofActive`, una ejecución terminada hace menos de 90 segundos también aparece como `Trabajando`. Para actividad remota no existe un ciclo `started/running/finished` o heartbeat verificable.

4. **La telemetría de errores de agentes no es compartida.**
   `_ofAgentErrors` vive únicamente en memoria durante diez minutos. Un error visto en un navegador puede no aparecer en otro y desaparece al recargar.

5. **La salud puede indicar “Todo en orden” con automatizaciones desconocidas.**
   `Sin telemetría` no se convierte en alerta. Solo Lead Worker tiene `expectMins`; los demás servicios pueden permanecer sin señal o con datos viejos sin degradar la salud general.

6. **El feed expone consultas y resultados completos.**
   Cualquier rol con acceso a Oficina puede buscar, abrir y copiar prompts/resultados que podrían contener datos de clientes, finanzas, personal o estrategia. El RBAC protege saltos entre pestañas, pero no aplica redacción o permisos por ejecución/campo.

7. **La conversión de actividad en presencia mezcla fuentes y momentos diferentes.**
   Logs, cola, automatizaciones, máquinas e inventario se refrescan mediante cachés independientes. La pantalla no muestra el timestamp de cada fuente, por lo que un único estado visual puede combinar datos de distintos minutos.

### Altos

8. **La deduplicación de logs puede eliminar ejecuciones legítimas.**
   La llave usa agente, timestamp —o prefijo del input— y los primeros 30 caracteres. Dos ejecuciones similares pueden colapsarse; formatos de fecha local/remota también pueden impedir la deduplicación correcta.

9. **Backlog se interpreta como disponibilidad del Lead Worker.**
   Si existen tareas, un worker `of-off` puede pasar a `En cola`, aunque precisamente esté caído y por eso se acumule trabajo.

10. **`EjecucionesHoy` carece de período verificable.**
    La Oficina suma el número informado por cada automatización sin comprobar a qué fecha o zona horaria corresponde.

11. **Inventario puede fallar silenciosamente.**
    La lectura se considera decorativa y no activa `_ofErr`. El digest puede reportar stock vacío o antiguo mientras la salud permanece verde.

12. **Telemetría viva de impresoras depende del estado del navegador.**
    `_printerStatus` solo está disponible si otro flujo del frontend lo pobló. De lo contrario se usa el estado potencialmente viejo de Airtable.

13. **“Empleado del mes” mide volumen, no desempeño.**
    Premia el mayor número de ejecuciones sin considerar calidad, errores, costo, SLA, impacto o resultado comercial. Además se basa en la muestra incompleta de logs.

14. **Agentes “dormidos” pueden ser falsos positivos.**
    La regla usa actividad histórica truncada; la ausencia dentro de las últimas 100 filas no demuestra inactividad real.

15. **Las fechas usan varias restas fijas de 86.400.000 ms.**
    Comparaciones de día, semana y rangos pueden desviarse durante cambios de horario de verano en Chile.

16. **La búsqueda conserva el output completo en memoria.**
    Aunque la lista muestre previews, el filtro concatena consulta y resultado completos, aumentando exposición y retención en el cliente.

### Medios

17. El SVG exportado referencia un logo externo; puede quedar incompleto sin red.
18. El mapa de automatizaciones sobrescribe silenciosamente IDs normalizados duplicados.
19. Exportar, copiar el digest o copiar resultados no pide confirmación reforzada ni aplica redacción de información sensible.
20. Las incidencias son avisos visuales, no tickets con responsable, SLA, estado y cierre.
21. La salud no diferencia claramente `desconocido`, `degradado`, `caído` y `pausado por diseño`.
22. Los gráficos y premios no explican que miden cantidad de ejecuciones, no productividad humana.

## Arquitectura recomendada

### Presencia y ejecuciones

1. Crear una tabla o stream autoritativo de ejecuciones con `execution_id`, `started_at`, `heartbeat_at`, `finished_at`, estado y error.
2. Hacer que `_ofActive` sea solo una optimización local, nunca la única fuente.
3. Consultar agregados server-side para 7/14/30 días y paginar el feed.
4. Deduplicar por `execution_id` o record ID durable.
5. Mostrar timestamp, fuente y frescura de cada bloque de datos.

### Automatizaciones e impresoras

1. Exigir heartbeat y cadencia esperada por servicio.
2. Separar estado del worker del tamaño de su backlog.
3. Registrar `activo`, `degradado`, `desconocido`, `atrasado`, `caído` y `pausado`.
4. Inicializar la telemetría de impresoras mediante store compartido o consulta directa al bridge.
5. Convertir alertas importantes en incidencias trazables.

### Privacidad

1. Clasificar ejecuciones por sensibilidad y propietario.
2. Aplicar permisos por rol, agente, cliente y tipo de dato antes de entregar el log al navegador.
3. Redactar RUT, emails, teléfonos, montos sensibles, credenciales y contenido privado.
4. Limitar búsqueda, copia, digest y exportación según permisos.
5. Definir retención del feed y auditoría de acceso/copia.

### Métricas

1. Renombrar rankings a “volumen de ejecuciones” o combinar calidad, SLA, costo, error e impacto.
2. Calcular días mediante zona `America/Santiago` y operaciones de calendario, no milisegundos fijos.
3. Asociar `EjecucionesHoy` con fecha y zona horaria.
4. Deshabilitar premios cuando la cobertura de datos sea incompleta.

## Criterios de aceptación

- Dos usuarios ven la misma presencia, cola, errores y ranking para el mismo instante.
- `Trabajando` solo aparece con una ejecución abierta y heartbeat vigente.
- La cola cuenta únicamente tareas realmente pendientes/procesables.
- Cada automatización e impresora tiene heartbeat y frescura visibles.
- `Todo en orden` nunca aparece cuando una fuente obligatoria está desconocida o vencida.
- Las vistas de 30 días cubren el período completo o declaran explícitamente su muestra.
- Ningún rol recibe prompts/resultados que no está autorizado a ver.
- Copias y exportaciones aplican redacción y dejan trazabilidad.
- Las fechas funcionan correctamente durante cambios de horario en Chile.
- Los `TODO` de `tests/oficina-wiring.test.js` se convierten en pruebas obligatorias al implementar cada corrección.
