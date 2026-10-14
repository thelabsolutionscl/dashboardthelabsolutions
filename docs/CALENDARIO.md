# CALENDARIO — eventos del equipo con Google Calendar

Sección **Calendario** del panel: eventos de **Nicanor, Gustavo y Florencia** con
alarmas/notificaciones y sincronización al **Google Calendar personal** de cada uno.

## Qué hace

- **Crear / editar / eliminar** eventos (título, fecha, horas o todo-el-día,
  personas asignadas, lugar, notas).
- **Alarmas**: popup de Google (`reminders.overrides`), recordatorio por correo,
  y aviso en la app (campana 🔔 + notificación del navegador) minutos antes.
- **Compartido casi en vivo**: los eventos se respaldan en Airtable
  (`Monitor Sistema` » registro `CALENDARIO`) y cada navegador los relee cada
  ~20 s (mismo patrón de fusión por `mts` + lápidas `del` que la agenda de equipo).
- **Google Calendar**: cada evento se escribe en el calendario de cada persona
  asignada. Visible por roles `admin`, `gerencia` y `comercial` (`RBAC.tabs`).

## Configuración (una vez)

1. **Google Cloud**:
   - Habilitar **Google Calendar API**.
   - En la pantalla de consentimiento OAuth, agregar el scope
     `https://www.googleapis.com/auth/calendar.events`.
   - **Navegador web:** puede seguir usando el Client ID web que comparte el panel con Drive; el origen JavaScript autorizado debe incluir `https://dashboard.thelab.solutions`.
   - **The Lab CRM para macOS (Tauri 1.2.0+):** crear además un OAuth Client ID de tipo **Aplicación de escritorio** en el mismo proyecto. Google no permite OAuth dentro de un `WKWebView`, por lo que la app abre Safari/Chrome y recibe el retorno por `127.0.0.1` usando PKCE. El Client ID de escritorio no es un secreto y se guarda localmente en ese Mac cuando se pega por primera vez.
2. En la sección **Calendario → ⚙ Calendarios de cada uno**: poner el correo de
   Google de Nicanor, Gustavo y Florencia (se guarda compartido para todos).
3. Cada usuario pulsa **🔗 Conectar Google Calendar** una vez por navegador/app y
   **🔔 Avisos** para permitir notificaciones del navegador.
   - En macOS/Tauri, la primera conexión pide pegar el **Client ID de Aplicación de escritorio**. Luego Google se abre en el navegador del sistema; al terminar, se vuelve a The Lab CRM sin recargar ni dejar la ventana negra.

## Cómo sincroniza con Google

- **Modo directo**: si la cuenta conectada puede escribir en el calendario de la
  persona (calendario compartido con permiso "Hacer cambios"), el evento se crea
  directo ahí (`calendars/{email}/events`).
- **Modo invitación** (fallback automático en 403/404): el evento se crea en el
  calendario de quien está conectado (`primary`) con la persona como invitada —
  llega igual a su Google Calendar con `sendUpdates=all`.
  *Limitación de Google*: en este modo las alarmas configuradas aplican a la
  copia del organizador; el invitado recibe sus recordatorios por defecto.
- Ediciones → `PATCH`; quitar a una persona o borrar el evento → `DELETE` de su
  copia. El estado de sync viaja en el evento (`gcal`, `gsyncMts`) por el respaldo
  compartido, así **cualquier** navegador conectado empuja lo pendiente
  (⇅ Sincronizar calendario, o automático si ya hay sesión de Google Calendar activa).

## Detalles técnicos

- Módulo: `js/calendario.js`. Panel/modal/estilos: `index.html`
  (`#tab-calendario`, `#calEventoModal`, `#calendario-styles`).
- Almacén local: `thelab_calendario_v1` (compartido en el navegador);
  mapa persona→email: `thelab_cal_gmap_v1`; alarmas disparadas: `thelab_cal_fired_v1`.
- El respaldo cabe en el campo `Notes` (~95 k): `_calFitBudget` poda primero los
  eventos pasados más antiguos; las lápidas se conservan 60 días (o mientras
  tengan copia en Google pendiente de borrar).
- Access token OAuth: solo en memoria (nunca en localStorage ni en el respaldo).
- En macOS/Tauri, solo se persiste el **Client ID de escritorio** en `localStorage`; el flujo usa navegador del sistema + loopback `127.0.0.1` + PKCE.
- Zona horaria de los eventos: `America/Santiago`.

## Fondos concursables (módulo TLS)

- La sección **Calendario** muestra una tarjeta **Fondos concursables** con fechas de apertura y cierre verificadas en fuentes oficiales, además de un listado de programas **Por anunciar**. Catálogo versionado en `data/fondos-concursables.json`, revisado en fecha identificada.
- Cada fecha publicada se presenta como evento virtual 🟢 apertura / 🔴 cierre en las vistas mes, semana y agenda. No se arrastra, no crea eventos en CRM ni se sincroniza automáticamente con Google Calendar.
- Los programas sin fechas oficiales se muestran sin fecha, nunca extrapoladas desde años anteriores. El catálogo inicial **NO garantiza cobertura exhaustiva ni consulta en tiempo real**; las bases pueden modificarse.
- La compatibilidad de TLS es solo preliminar: deben verificarse primera categoría, ventas en UF, actividad, comuna/región, aportes, deudas, subsidios previos y otros requisitos de la convocatoria.
- El **agente de postulaciones** recibe preguntas pegadas por el usuario y antecedentes confirmados, usa el motor IA existente y entrega **borradores para copiar**, junto con requisitos pendientes. No envía postulaciones ni completa sitios externos. No pegar RUT personales, contraseñas, tokens o información sensible.
- Código: `js/calendario-fondos.js`; catálogo: `data/fondos-concursables.json`; integración virtual: `js/calendario-base.js` y `js/calendario.js`. La preferencia de visualización se guarda solo en el navegador como `thelab_fondos_mostrar_v1`.
- **Descubrimiento programado:** `.github/workflows/fondos-monitor.yml` consulta de lunes a viernes un calendario público de Sercotec. Cuando detecta ventanas plausibles, abre un PR solo con `data/fondos-detectados.json` para **revisión humana**, nunca actualiza automáticamente el calendario visible. El monitor no cubre todavía todas las convocatorias de Corfo ni todos los fondos nacionales.
- El agente también acepta **Otra convocatoria (manual)**, para redactar respuestas aunque no figure en el catálogo; no puede abrir ni enviar formularios externos.
- **Actualización de fechas:** revisar fuentes y publicar nuevas convocatorias en el catálogo cuando estén verificadas. Portales oficiales: https://www.sercotec.cl/convocatoria/, https://www.corfo.cl/sites/cpp/area/innovacion y https://www.fondos.gob.cl/.

## Avisos de fondos concursables: Gustavo y Nicanor

- **Catálogo ampliado (14/10/2026):** incluye Sercotec Crece, Crece Sostenible, Kit Digital, MejoraNegocios, Pymes Globales y Negocios Digitales; y Corfo Gestión de Innovación en Pymes, Crea y Valida, Consolida y Expande, Desarrolla Inversión Productiva RM, Red Proveedores RM, Innova Región RM, FOCAL y Crea y Valida Eureka. La inclusión no significa elegibilidad comprobada: cada programa exige revisar versión de bases, focalización, RUT de empresa, ventas anuales, antigüedad, cofinanciamiento y estado de convocatoria.
- Se muestra **apertura y cierre** de cada concurso con fechas verificadas. Los programas recurrentes con llamados aún no publicados quedan visibles como **Por anunciar**, sin fechas ni alertas inventadas. Llamados de otras regiones/sectores no se introducen como compatibles sin evidencia.
- **Aviso en el dashboard:** el día de apertura y de cierre, NOTIFY.priority crea una alerta personal para Gustavo y Nicanor cuando ingresan a su sesión. Se comprueba al cargar el catálogo y cada 15 minutos mientras la página siga abierta; clave por usuario, concurso, fase y fecha para no repetir avisos descartados en ese navegador.
- **Aviso por correo:** el cron existente de `thelab-leads-worker` (`17 * * * *`) consulta el catálogo publicado y, desde las **09:00 hora de Santiago** (primera pasada habitual a las 09:17), envía un correo individual a `gustavo@thelab.solutions` y `nicanor@thelab.solutions` para cada fase **del mismo día**. Nunca envía correos retroactivos ni para programas sin fecha. Es independiente de que el dashboard esté abierto.
- El envío utiliza el secreto `RESEND_API_KEY` y el KV `RL` existentes del lead-worker; sin ellos se omite el envío y se registra el motivo. Anti-duplicación: una clave persistente por concurso, fecha, fase y destinatario en KV, más la cabecera `Idempotency-Key` de Resend para reintentos. Un error del proveedor no marca la notificación como entregada y la próxima pasada podrá reintentar. No comparte tokens, contraseñas ni datos del postulante.
- Variables configurables en `lead-worker/wrangler.toml`: `FONDOS_NOTIFY_ENABLED`, `FONDOS_NOTIFY_TO_GUSTAVO`, `FONDOS_NOTIFY_TO_NICANOR`. Por seguridad el remitente se toma de `RESEND_FROM` y los destinatarios aceptados deben pertenecer al dominio corporativo `thelab.solutions`.
- **Activación real:** requiere que el pipeline `Deploy Cloudflare Workers` efectivamente haya desplegado `lead-worker`; ese pipeline puede saltarse el despliegue si falta `CLOUDFLARE_API_TOKEN`. Verificar además secreto RESEND_API_KEY en Cloudflare y que los dos correos puedan recibir mensajes. Un CI verde por sí solo NO prueba envío real.
- **Alcance de verificación:** revisión de fichas de Sercotec (convocatorias y bases RM) y Corfo (portal convocatorias, territorios RM y nacional), con fechas históricas 2026 verificadas. No existe un catálogo único exhaustivo de todos los fondos regionales/sectoriales/privados ni actualización instantánea. Se requiere mantener y revisar las bases oficiales, y ampliar la detección automatizada de otros organismos cuando se disponga de un feed estructurado fiable.

### Auditoría de cobertura 14/10/2026

La revisión distingue **subsidios concursables para empresas existentes** de **servicios y apoyo no monetario** y de **instrumentos asociativos**. Se incorporan al seguimiento los programas oficiales Sercotec Promoción y Canales de Comercialización y Sello Impacta Sustentable, y Corfo Red Asociativa. Estos tres **no tienen fechas RM verificadas**, por lo que no generan eventos ni avisos hasta que se confirmen bases concretas. Promoción y Canales financia participación en ferias (según convocatoria); Sello Impacta entrega asesoría/reconocimiento, no dinero; Red Asociativa requiere un grupo de empresas y umbrales de ventas.

No se agregan como «compatibles» instrumentos exclusivamente para empresas sin inicio de actividades o sin ventas (Capital Semilla, Capital Abeja, Semilla Inicia) ni convocatorias de otras regiones sin alcance nacional. ProChile Servicios/Industrias Creativas 2027 exige estrategia sectorial y no se presenta como postulación individual de TLS. El universo de fondos cambia continuamente y **ningún catálogo local garantiza encontrar todos**: revisar periódicamente Sercotec, Corfo, Gobierno Regional RM, ProChile y Fondos.gob.cl. Conservar fecha nula cuando no exista anuncio oficial por programa y región.

Las notificaciones por correo (Gustavo y Nicanor) se ejecutan en `lead-worker/src/fondos-notify.js` a través del cron de `lead-worker`. Son exclusivas de fondos con fecha de apertura o cierre validada y **no se envían por convocatorias históricas**. Requieren KV `RL`, `RESEND_API_KEY` y un desplegado real de `lead-worker`. La bandeja personal del dashboard avisa a las cuentas autenticadas; el cron permite avisos incluso con el dashboard cerrado. Las alertas por correo de Resend no pueden garantizar entrega final sin consultar registros de proveedor/destinatario.


### Auditoría de cobertura y avisos (14/10/2026)

- **Catastro supervisado:** 24 convocatorias/programas potenciales de Sercotec y Corfo, 10 con ventanas históricas registradas y 14 sin fechas actuales confirmadas. No representa todos los fondos públicos de Chile ni acredita elegibilidad automática de TLS. Se excluyen convocatorias restringidas a regiones no-RM, personas sin inicio de actividades (Semilla/Abeja), sectores sin relación y llamados dirigidos a personas naturales cuando TLS postula como empresa.
- **Nuevas líneas revisadas en fuente oficial:** Corfo Absorción Tecnológica para la Innovación (PATI; convocatoria 18/11/2025–15/07/2026, nacional, exige proyecto colectivo), Capital Humano para la Innovación (18/11/2025–28/05/2026, con I+D+i real) e Innova Alta Tecnología/Eureka (solo proyectos de alta complejidad con cooperación internacional). Se mantienen programas futuros sin fechas ficticias. Los instrumentos pueden requerir un gestor, antigüedad tributaria, ventas o cofinanciamiento.
- **Revisión automática ampliada:** `.github/workflows/fondos-monitor.yml` consulta diariamente en días hábiles el calendario público de Sercotec y ahora también revisa las fichas oficiales de Corfo incluidas en el catálogo. Publica **solo propuestas de revisión** en `data/fondos-detectados.json` y `data/fondos-corfo-por-revisar.json`; nunca modifica automáticamente el catálogo público o genera alarmas sin validar la convocatoria y sus bases.
- **Destinatarios:** Gustavo y Nicanor. El `thelab-leads-worker` ejecuta un cron horario, filtra la fecha `America/Santiago` desde las 09:00 y envía un correo individual por Resend el día de cada apertura y cada cierre **confirmados**; guarda clave por persona/fondo/fase/fecha en KV y usa idempotencia de Resend. El dashboard también agrega un aviso personal al iniciar sesión y revisa de nuevo cada 15 minutos mientras está abierto. No hay avisos históricos retroactivos ni para programas sin fecha.
- **Requisito operativo:** un deploy correcto del Worker no demuestra entrega. Validar que Cloudflare tenga `RESEND_API_KEY` y el binding KV `RL`, que el cron esté habilitado y que los dos buzones corporativos reciban una prueba real. Sin acceso a esas credenciales ni al buzón, el código no puede certificar entrega efectiva. La `hora` 00:00 en PATI es marcador técnico de una fecha **sin hora oficial publicada**, y se muestra como tal.
- **Fuentes oficiales principales:** https://www.sercotec.cl/convocatoria/, https://www.corfo.gob.cl/sites/cpp/programa/programa-absorcion-tecnologica-innovacion/, https://www.corfo.gob.cl/sites/cpp/convocatoria/capital-humano-para-la-innovacion-2025/ y https://www.fondos.gob.cl/. Las futuras convocatorias deben pasar revisión manual antes de activar alertas.

### Revisión de cobertura 14/10/2026

- Se incorpora el concurso oficial de **ProChile Servicios e Industrias Creativas 2027**, con apertura el 23/07/2026 a las 12:00 y cierre el 20/08/2026 a las 17:00, ambos históricos, respaldados en https://www.prochile.gob.cl/herramientas/concursos/. Solo proyectos **sectoriales** con postulante y servicios admisibles, por lo que TLS no debe considerarse beneficiario directo asegurado.
- Se agrega seguimiento de la **próxima convocatoria ProChile** sin asignar fechas ni notificaciones hasta su publicación oficial.
- La búsqueda contempla Sercotec, Corfo y el nuevo instrumento de ProChile, pero **no puede afirmar que detecta todos los fondos** de cada municipio, GORE, corporación o agencia. Hay llamados acotados a localidades, rubros, tipos de persona o consorcios. Registrar solo los potencialmente aplicables a TLS y revisar condiciones vigentes.
- Los avisos por correo preparados para Gustavo y Nicanor requieren comprobar el secreto `RESEND_API_KEY`, el KV `RL` y una **prueba real de entrega** de ambos buzones; un workflow exitoso solo confirma código desplegado, no correos recibidos.

### Llamados a vigilar en noviembre 2026 — fuentes oficiales (14/10/2026)

Por solicitud de gerencia se incorporaron al catálogo cuatro **programas en seguimiento**: Semilla Inicia, Semilla Expande, un próximo llamado de Crea y Valida, y Start-Up Chile BIG (Build, Ignite y Growth). El aviso de posible actividad en noviembre **no es una fecha oficial de apertura/cierre**. Los cuatro registros tienen `open: null` y `close: null`; no aparecen como hitos fechados ni producen correos hasta verificar una nueva convocatoria. Esto evita extrapolar de otras regiones, años o documentos privados. El histórico **BIG 11 Build de noviembre 2025** se preserva por separado (05/11 13:00 al 28/11 13:00).

- **Semilla Inicia:** la empresa existente TLS con ventas no sería elegible bajo la ficha oficial vigente para empresas con inicio de actividades: menos de 18 meses y **sin ventas**. Se monitoriza por indicación de gerencia y para un eventual emprendimiento distinto que cumpla íntegramente bases.
- **Semilla Expande:** personas jurídicas con menos de 36 meses de inicio de actividades y máximo $80 millones netos de ventas en los últimos 12 meses, según ficha oficial actual; adicionalmente, solución innovadora, ventas de esa solución y expansión real. No se da por elegible a TLS.
- **Crea y Valida:** pertinencia potencial para I+D de manufactura avanzada y prototipos nuevos, con 24 meses de primera categoría y ventas acreditadas. La ficha nacional 2026 cerró el 04/08/2026 y anuncia **resultados el 27/11/2026**; esta última fecha **no es nueva apertura de postulaciones**. Un nuevo llamado debe registrarse con identidad, bases y plazos propios, incluido perfil previo cuando corresponda.
- **Start-Up Chile BIG:** la generación 11 abrió en noviembre 2025; la 12 abrió en mayo 2026. No consta todavía una convocatoria nueva de noviembre 2026 en la portada oficial. Build, Ignite y Growth son líneas distintas y exigen startup tecnológica escalable, más requisitos variables de etapa, antigüedad, ingresos y equipo.

**Vigilancia ampliada:** el workflow `.github/workflows/fondos-monitor.yml` sigue con cron en días hábiles, revisa Sercotec y ahora Corfo, ProChile y Start-Up Chile, y propone señales en archivos de staging para **revisión humana**. Esto no transforma por sí solo datos públicos en fechas oficiales; un responsable debe comprobar nueva ficha/bases, zona horaria, territorio, etapa y elegibilidad, para entonces actualizar el catálogo mediante PR. Recién al publicarse una fecha concreta el Worker puede avisar a Gustavo y Nicanor por apertura o cierre del día (sin notificación retroactiva). Ni un deploy verde ni la confirmación de aceptación por Resend prueban recepción en ambos buzones; falta ensayo real en las dos casillas.

Fuentes:
- https://www.corfo.gob.cl/sites/cpp/programa/semilla-inicia/
- https://www.corfo.gob.cl/sites/cpp/programa/semilla-expande/
- https://www.corfo.gob.cl/sites/cpp/convocatoria/crea-y-valida-2026/
- https://www.corfo.gob.cl/sites/cpp/convocatoria/start-up-chile-build-11-2025/
- https://startupchile.org/
- https://www.prochile.gob.cl/herramientas/concursos/

### Interfaz TLS para fondos (diseño octubre 2026)

El módulo **Fondos concursables** conserva su ubicación dentro de Calendario, el catálogo oficial y el copiloto, pero presenta la información con el lenguaje visual nativo de The Lab Solutions: fondo dark, acentos cyan, panel tipo glass, indicadores de oportunidades, tarjetas y estados legibles. La hoja `fondos-tls.css` se carga solo desde `js/calendario-fondos.js`, para no modificar la estética de otros módulos.

- **Radar superior**: total de programas, pendientes de nueva convocatoria, aperturas futuras con fecha oficial y convocatorias cerradas; los números representan registros en el catálogo y no subsidios concedidos ni elegibilidad comprobada.
- **Filtros y búsqueda**: Todos, En seguimiento, Con fechas próximas e Históricos, más texto por nombre, organismo, categoría o pertinencia. El filtro de la sección original continúa sincronizado.
- **Tarjetas**: primero los cuatro programas en seguimiento especial de noviembre, después llamados vigentes/próximos y el resto. Explican encaje preliminar con TLS, región, organismo, ventana oficial cuando existe, botón para saltar al calendario, enlace a bases y acceso al agente para preparar un **borrador**, sin suponer que una postulación fue enviada.
- **Detalle ampliado**: requisitos, justificación, respaldo, fechas y enlace oficial. Tecla Escape cierra el diálogo; se respetan los accesos ya existentes.
- **Diseño adaptable** a pantallas pequeñas y con estilos de foco visible, y compatibilidad con la preferencia de movimiento reducido.
- **Seguridad funcional**: búsqueda y presentación solo usan texto escapado del catálogo aprobado; nunca alteran fechas, alertas del Worker, Google Calendar, elegibilidad ni envío de formularios externos.

Pruebas: `tests/fondos-visual-tls.test.js` más las auditorías preexistentes de `tests/calendario-fondos.test.js` y `tests/fondos-alertas.test.js`.
