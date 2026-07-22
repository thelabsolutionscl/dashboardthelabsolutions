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

1. **Google Cloud** (mismo proyecto del Client ID de Drive que ya usa el panel):
   - Habilitar **Google Calendar API**.
   - En la pantalla de consentimiento OAuth, agregar el scope
     `https://www.googleapis.com/auth/calendar.events`.
   - El origen JavaScript autorizado debe incluir el dominio del panel.
2. En la sección **Calendario → ⚙ Calendarios de cada uno**: poner el correo de
   Google de Nicanor, Gustavo y Florencia (se guarda compartido para todos).
3. Cada usuario pulsa **🔗 Conectar Google** una vez por navegador y
   **🔔 Avisos** para permitir notificaciones del navegador.

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
  (⇅ Sincronizar, o automático si ya hay sesión de Google activa).

## Detalles técnicos

- Módulo: `js/calendario.js`. Panel/modal/estilos: `index.html`
  (`#tab-calendario`, `#calEventoModal`, `#calendario-styles`).
- Almacén local: `thelab_calendario_v1` (compartido en el navegador);
  mapa persona→email: `thelab_cal_gmap_v1`; alarmas disparadas: `thelab_cal_fired_v1`.
- El respaldo cabe en el campo `Notes` (~95 k): `_calFitBudget` poda primero los
  eventos pasados más antiguos; las lápidas se conservan 60 días (o mientras
  tengan copia en Google pendiente de borrar).
- Token OAuth: solo en memoria (nunca en localStorage ni en el respaldo).
- Zona horaria de los eventos: `America/Santiago`.
