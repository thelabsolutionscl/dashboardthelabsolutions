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
