# Auditoría de REDES SOCIALES

Fecha: 2026-08-02

## Alcance

Se revisaron conjuntamente:

- La pestaña Redes del dashboard (`index.html` y `js/redes.js`).
- Las tablas `Social_Posts`, `Social_Interactions` y `Social_Metrics`.
- El webhook público `POST /webhooks/social` del Worker.
- La generación mediante agentes IA, calendario, piloto automático, inbox, leads y reportes.
- El contrato operativo documentado para Airtable, Make y las plataformas sociales.
- La suite lógica existente `tests/redes.test.js`.

## Flujo observado

1. `Social_Posts` funciona como cola editorial y de publicación.
2. El dashboard genera contenido con IA, permite editarlo, aprobarlo, programarlo, moverlo en calendario y reciclarlo.
3. Make debería tomar publicaciones programadas y actualizar su estado después de publicarlas en la plataforma.
4. `Social_Interactions` recibe comentarios, DMs y menciones.
5. `COMMUNITY_AGENT` propone respuestas, intención y clasificación de lead.
6. Un lead puede crearse desde el Worker durante la ingesta o manualmente desde el dashboard.
7. `Social_Metrics` alimenta KPIs, tendencias, mejor horario, reciclaje y reporte semanal.
8. El piloto automático puede generar posts para huecos y programar borradores existentes.

## Controles confirmados

- El módulo carga datos mediante token o proxy y evita recargas solapadas.
- El modo demo mantiene posts, interacciones y métricas en memoria y usa `_redesWrite` para la mayoría de las escrituras.
- El ciclo editorial contempla `Borrador`, `En revisión`, `Programado` y `Publicado`.
- Programar exige fecha y hora.
- El calendario mensual/semanal permite reprogramar mediante drag and drop.
- La generación puede usar un pedido entregado y su `Foto QA URL` como contexto.
- El parser puede guardar una salida de IA como un post por red.
- Las respuestas se generan secuencialmente para no saturar Claude.
- El dashboard intenta enlazar la interacción con `Clientes` y `Agent_Queue`.
- El piloto automático tiene guard de concurrencia y confirmación humana inicial.
- El webhook normaliza redes/tipos, detecta quejas y puede llamar a `createLeadAndQueue`.
- Existe RBAC específico para que marketing escriba únicamente en las tablas necesarias.
- Ya existen pruebas puras para parser por red, sentimiento y mejor día.

## Hallazgos

### Críticos

1. **El webhook social puede usar una clave pública.**
   `handleSocial()` acepta `SOCIAL_WEBHOOK_KEY`, pero también cae a `PUBLIC_LEAD_KEY`. Esa clave pública no debe autorizar creación de interacciones, clientes ni tareas.

2. **No existe idempotencia de eventos sociales.**
   Un reintento de Make o de la plataforma vuelve a crear `Social_Interactions` y, si `esLead=true`, puede crear también otro Cliente y otra tarea. Falta una llave única por `red + external_event_id`.

3. **El Worker crea leads sin cerrar la interacción.**
   Cuando `handleSocial()` llama a `createLeadAndQueue`, la fila recién creada no queda con `Lead creado=true` ni con los IDs del Cliente/tarea. El dashboard seguirá mostrando “Crear lead” y puede duplicarlo.

4. **La conversión manual no es transaccional.**
   `redesInteractionToLead()` crea primero el Cliente, luego intenta la tarea y finalmente marca la interacción. Si falla el último paso o se recarga la página, el usuario puede crear otro Cliente para el mismo mensaje.

5. **“Publicado” no demuestra publicación externa.**
   Un botón local puede establecer `Estado=Publicado` y `Fecha publicación=ahora` sin ID, permalink ni confirmación de Meta/LinkedIn/TikTok. Los KPIs pueden mostrar una publicación inexistente.

6. **El panel confunde actividad reciente con integración activa.**
   `_redesAutoStatus()` interpreta una fila reciente como prueba de que Make escucha, mide o publica. Una carga manual o un clic en “Marcar publicado” puede mostrar falsamente “activo”.

7. **El piloto automático omite el estado de revisión.**
   Los posts generados para huecos se crean directamente como `Programado`; `redesAutoSchedule()` también transforma borradores en programados. Si Make está conectado, contenido no revisado puede publicarse.

### Altos

8. **Responder es un estado manual sin evidencia.**
   “Marcar respondido” solo cambia `Estado`; no guarda ID externo, fecha, canal ni confirma que la respuesta llegó a la plataforma.

9. **El reporte semanal mezcla períodos.**
   `_redesBuildMetricsContext()` filtra publicaciones desde hace siete días, pero no pone límite superior: puede incluir publicaciones futuras. También cuenta todas las interacciones cargadas, no solo las de la semana.

10. **El “mejor día” está sesgado por volumen.**
    `_redesBestByWeekday()` suma engagement bruto. Un día con más filas gana aunque cada publicación rinda peor. Debe usarse promedio o tasa normalizada por alcance/publicación.

11. **Las lecturas están truncadas.**
    `redesLoad()` solicita como máximo 200 posts, 200 interacciones y 365 métricas sin paginar. El calendario, inbox, top performers y analítica dejarán de representar el histórico completo.

12. **Eliminación rompe el aislamiento demo.**
    `redesDeletePost()` llama `airtableWrite()` directamente, no `_redesWrite()`. En demo puede intentar contactar el backend productivo aunque los IDs de ejemplo normalmente fallen.

13. **El editor puede dejar `Publicado` incompleto.**
    `redesSaveEdit()` guarda el estado y la fecha programada, pero no completa `Fecha publicación` ni evidencia externa cuando el usuario elige `Publicado`.

14. **No hay deduplicación por identidad social.**
    Interacciones diferentes del mismo `red + platform_user_id` pueden generar múltiples clientes sin una resolución previa del contacto existente.

### Medios

15. `Social_Metrics` necesita upsert por `red + fecha`; filas duplicadas distorsionan tendencias y horarios.
16. `Media URL` y `Link` se guardan sin una política de protocolo/host antes de que Make o una plataforma los consuma.
17. Las quejas se priorizan visualmente, pero no crean un ticket con responsable, SLA, escalamiento y cierre verificable.
18. El reporte IA no conserva una instantánea versionada de datos, prompt, modelo y aprobador.
19. Los horarios sugeridos usan horas fijas por red y no registran zona/configuración por cuenta.
20. La documentación señala que las conexiones sociales de Make estaban pendientes; el dashboard no verifica el estado real del escenario antes de ofrecer automatización.

## Arquitectura recomendada

### Ingesta e interacciones

1. Exigir `SOCIAL_WEBHOOK_KEY` exclusivo y rotatable.
2. Recibir `external_event_id`, `platform_user_id`, `platform_post_id` y timestamp original.
3. Hacer upsert/reserva atómica antes de procesar el evento.
4. Guardar en la interacción `Cliente creado`, `Agent_Queue ID`, estado de procesamiento y error.
5. Resolver Cliente por identidad social antes de crear uno nuevo.
6. Separar `Respuesta sugerida`, `Respuesta aprobada`, `Respuesta enviada` y `Respuesta confirmada`.

### Publicación

1. Separar estado editorial de estado de transporte/plataforma.
2. Flujo recomendado: `Borrador → En revisión → Aprobado → Programado → Publicando → Publicado/Error`.
3. Registrar `External Post ID`, permalink, fecha devuelta por la plataforma, intentos y error.
4. Utilizar lock/lease e idempotency key para cada publicación.
5. El dashboard no debe inferir una integración activa: debe leer heartbeats de Make/Worker por escenario.

### Automatización y analítica

1. El piloto debe crear contenido en `En revisión`, salvo que exista una política explícita de autopublicación aprobada y versionada.
2. Paginar o consultar vistas por rango temporal.
3. Hacer upsert de métricas por red/cuenta/fecha.
4. Calcular engagement rate y promedios por publicación, no solo sumas.
5. Construir reportes con una ventana cerrada `[inicio, fin]` y snapshot reproducible.

## Criterios de aceptación

- Reintentar el mismo webhook no crea otra interacción, Cliente ni tarea.
- Una interacción procesada por Worker aparece cerrada y enlazada en el dashboard.
- Dos acciones concurrentes no pueden crear dos leads para la misma interacción.
- `Publicado` siempre tiene evidencia de plataforma o queda identificado expresamente como publicación manual no verificada.
- El panel automático refleja healthchecks reales de cada integración.
- Ningún contenido generado automáticamente pasa a publicación sin la política de aprobación correspondiente.
- Las respuestas confirmadas guardan canal, fecha e ID externo.
- Calendario, inbox y analítica no se truncan silenciosamente.
- Métricas duplicadas no alteran tendencias.
- El reporte semanal excluye fechas futuras y datos fuera de su ventana.
- Los `TODO` de `tests/redes-wiring.test.js` se convierten en pruebas obligatorias al implementar cada corrección.
