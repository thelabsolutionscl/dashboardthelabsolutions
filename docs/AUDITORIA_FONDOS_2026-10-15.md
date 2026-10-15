# Auditoría técnica — Fondos concursables TLS

**Fecha:** 15 de octubre de 2026.  
**Base auditada:** rama main después de PR #487 (commit 5a93d607bc1319382f716264766e01a9c4d48d12).  
**Alcance:** `js/calendario-fondos.js`, `fondos-tls.css`, `data/fondos-concursables.json`, Calendario, monitor de fuentes y Worker de avisos, junto con pruebas.  
**Método:** inspección estática de código y contratos, revisión del catálogo, tests automatizados en GitHub Actions. No se verificó visualmente una sesión autenticada de producción ni se enviaron correos reales de prueba.

## Hallazgos confirmados y correcciones en este PR

| Ref | Severidad | Hallazgo y reproducción | Corrección |
| --- | --- | --- | --- |
| F-01 | Alta | `prepareFromWorkspace()` rellenaba `fondosPreguntas` con preguntas genéricas fabricadas y `draft()` etiquetaba ese texto como copiado por el usuario. Riesgo de producir respuestas inadecuadas para bases oficiales. | El campo queda vacío, con placeholder que exige copiar las preguntas textuales reales. |
| F-02 | Alta | El ranking colocaba automáticamente los cuatro programas vigilados arriba, incluido Semilla Inicia, marcado como no elegible para TLS existente. Programas cerrados competían visualmente con los utilizables. | Priorizar ventanas vigentes, futuras, seguimiento elegido por usuario, programas pendientes y al final incompatibles/históricos. |
| F-03 | Media | `today()` tomaba la fecha local del navegador y las alertas tomaban `America/Santiago`, divergiendo alrededor de medianoche desde otras zonas. | Fecha común para estados y filtros en horario de Chile, probada mediante reloj fijo. |
| F-04 | Alta | `draft()` mantenía respuesta previa visible al cambiar fondo; `copyDraft()` permitía copiar texto de error o un borrador para otro concurso. | Invalidación y limpieza por cambio de selección, error y edición; copia solo después de respuesta satisfactoria para el fondo actual. |
| F-05 | Media | `fundWindow()` interpretaba una fecha de apertura antigua sin cierre como ventana actualmente abierta. | Estados sin ambas fechas quedan marcados como incompletos y se excluyen del filtro de ventanas vigentes/futuras. |
| F-06 | Baja | Filtro «Mi seguimiento» sin elementos presentaba un vacío genérico. | Mensaje accionable para comenzar seguimiento. |
| F-07 | Alta | En días de apertura o cierre, el estado de la convocatoria comparaba únicamente la fecha y podía indicar abierta una vez superada la hora de cierre. | Comparación de horas/minutos en horario de Santiago, con pruebas de frontera. El valor 00:00 se conserva como hora desconocida. |

## Aspectos todavía pendientes

**P-01 · Alta: Fases obligatorias intermedias.** El modelo guarda apertura y cierre final, pero no hitos de *perfil obligatorio*, rectificaciones, etapas de evaluación, etc. Ejemplo: Crea y Valida 2026 requirió perfil previo según el campo `verified`; esa fecha no figura como evento en Calendario. Antes de usar el módulo para gestionar postulaciones reales, ampliar el esquema a hitos con etiqueta, fuente, hora y calidad de verificación. No inventar fechas futuras.

**P-02 · Alta: Verificación de notificaciones de extremo a extremo.** El Worker `lead-worker/src/fondos-notify.js` utiliza Resend/KV y cron horario, con pruebas unitarias de idempotencia, hora chilena y separación de destinatarios. No se comprobaron en esta auditoría credenciales/secretos desplegados, entrega real a Gustavo y Nicanor, rebotes, ni cron en Cloudflare. Se necesita prueba controlada y monitoreo operativo sin generar alertas ficticias en producción.

**P-03 · Media-alta: Actualización de oportunidades.** `scripts/fondos-monitor.js` y `scripts/fondos-watch-corfo.js` generan archivos para revisión humana por PR, no actualizan el catálogo real automáticamente (medida prudente). Se requiere dueño del proceso y plazo máximo de revisión, e indicadores de «última comprobación exitosa» y «pendientes» en dashboard para evitar apariencia de vigilancia en tiempo real.

**P-04 · Media: Seguimiento solo en localStorage.** La selección, etapa y siete casillas son locales al navegador (y a una identidad potencialmente aún no resuelta en inicialización). Gustavo y Nicanor pueden ver progresos diferentes; borrar datos locales los elimina. Recomendar tabla compartida, control de roles, versiones, asignados y auditoría de cambios. Evitar almacenar automáticamente textos confidenciales en el navegador.

**P-05 · Media: Pruebas del DOM insuficientemente integradas.** `tests/fondos-visual-tls.test.js` usa simulaciones mínimas del DOM en VM; los tests pueden aprobar aunque la integración final tenga problemas con selectores, estilos, service worker o autenticación. Agregar Playwright con instalación/carga real de página, filtros, teclado, formularios, modal y móvil, más una revisión accesible de foco y ARIA.

**P-06 · Media: Dependencia del servicio de IA.** Se utiliza `window.callAgentClaude` sin timeout propio del módulo, cancelación remota, límite de tiempo visible o trazabilidad de ejecución. El spinner puede quedar indefinido ante un Promise que no se resuelve. Considerar `AbortController` si el proxy lo soporta, timeout explícito, reintento seguro y errores diferenciados sin enviar dos veces solicitudes.

**P-07 · Media: Alertas previas.** El Worker solo notifica el mismo día de apertura y cierre y el calendario muestra hitos históricos; no avisa con antelación configurable (por ejemplo, 7/3/1 días), ni controla documentos a entregar, ni horarios de fases intermedias.

**P-08 · Baja: Gran densidad de código / CSS.** `js/calendario-fondos.js` incluye UI, parsers, demos, agenda, localStorage, IA y monitor de fechas en un módulo; el CSS usa selectores muy específicos y muchas reglas acumuladas. Extraer componentes y funciones puras reduce riesgo de regresión.

## Controles sanos confirmados por revisión

- La DEMO no escribe fechas ni llamadas al calendario real.
- `eventList()` crea hitos virtuales, excluidos de la sincronización de Google Calendar.
- El Worker restringe URLs oficiales y destinatarios del dominio `thelab.solutions`.
- Los avisos tienen claves idempotentes por persona, fondo, fase y fecha y horario basado en `America/Santiago`.
- El asistente indica expresamente que no verifica bases en vivo, no certifica elegibilidad ni envía postulaciones.

## Criterios para cierre completo de la auditoría

1. Los checks automatizados del PR son verdes.
2. Prueba funcional real con fondo sin fecha, fondo cerrado, proyecto editable, error IA, cambio de fondo y copia.
3. Prueba de entrega controlada de notificaciones reales y comprobación de Cloudflare Cron y Resend en entorno protegido.
4. Diseño y pruebas de hitos intermedios antes de confiar en el calendario para plazos críticos.

**Conclusión:** la interfaz gana coherencia y seguridad con F-01 a F-06, pero el cumplimiento de plazos y la fiabilidad de avisos dependen de P-01 a P-03. Este informe diferencia bugs corregidos de pendientes sin afirmar validación de producción que no se efectuó.
