# Monitoreo y alertas de caídas

Hasta ahora, si un Worker o un escenario de Make se caía, **nadie se enteraba**
hasta notar que dejaban de llegar leads. Esto cubre tres capas de vigilancia.
La #1 (Worker de leads) es la más crítica: si ese Worker cae, los leads del
formulario web se pierden en silencio.

## 1. Worker de leads caído → email (escenario Make)

| ID | Nombre | Cadencia | Estado |
|---|---|---|---|
| `5567610` | The Lab — Monitor · Worker de leads (health check) | cada 30 min | **inactivo** (falta pegar la URL) |

**Flujo:** HTTP GET a `…/health` del Worker → si no responde `200` o el cuerpo no
contiene `"ok":true`, envía un email de alerta (prioridad alta) a
`thelabsolutionscl@gmail.com` por la conexión SMTP existente.

**Para activarlo (2 pasos):**
1. En Make, abre el escenario `5567610` → módulo **HTTP** → reemplaza
   `https://PEGAR_URL_DEL_WORKER/health` por la URL real del Worker
   (la misma base de `NEXT_PUBLIC_LEAD_ENDPOINT`, p. ej.
   `https://thelab-leads-worker.<subdominio>.workers.dev/health`).
2. Activa el escenario (toggle ON). Para probar: cambia temporalmente la URL a
   una inexistente, corre "Run once" y confirma que llega el correo de alerta;
   luego restaura la URL buena.

> **Costo de operaciones:** a 30 min son ~1.440 ops/mes (≈14% del plan Core de
> 10.000). Si lo quieres más barato, sube el intervalo a 1 h (~720/mes). Si lo
> quieres más fino y **sin gastar ops de Make**, usa la opción 3.

## 2. Escenarios de Make que fallan → notificación nativa (GRATIS, actívalo ya)

Make puede avisarte por email cada vez que **cualquier** escenario falla, sin
gastar operaciones. No requiere construir nada:

1. En Make → tu **perfil** (arriba a la derecha) → **Notifications** /
   **Email preferences**.
2. Activa las notificaciones de **"scenario errors"** / cuando un escenario se
   desactiva por errores.
3. (Recomendado) En cada escenario crítico → *Settings* → sube el
   manejo de errores para que te avise en vez de morir en silencio.

Esto cubre el caso "un escenario se rompió" (p. ej. si WATI o Resend cambian
algo), que el monitor #1 no ve.

## 3. Uptime externo (GRATIS, mejor que Make para esto)

Para vigilancia de disponibilidad, un monitor externo es superior a Make: 0 ops,
chequeo cada 1–5 min y alertas por email/WhatsApp/Slack.

- **Cloudflare Health Checks** (nativo, ya usas Cloudflare): Dashboard de
  Cloudflare → *Traffic* → *Health Checks* → apunta al `/health` del Worker y a
  `thelab.solutions`. Alertas incluidas.
- **UptimeRobot** (plan gratis): crea monitores HTTP(s) para (a) el `/health`
  del Worker, (b) `https://thelab.solutions`, (c) el airtable-proxy si lo usas.
  Chequeo cada 5 min + alertas.

## 4. El riesgo que ninguna alerta técnica cubre: quedarse sin operaciones de Make

En junio 2026 la organización de Make **agotó sus 10.000 ops y se pausó** — y con
ella se detuvo *todo* (alertas, correos, WhatsApp) sin aviso. Vigila esto:

- En Make → **Organization → Usage**, revisa el consumo mensual. Si te acercas al
  tope, sube de plan o baja la frecuencia de los escenarios (varios corren cada
  1 h; muchos pueden ir a 2–4 h).
- Considera migrar los escenarios de *polling* (Search cada hora) a
  *event-driven* (Automatizaciones de Airtable → webhook a Make): consumo ~0 en
  reposo. Ver la nota en `NOTIFICACIONES_WHATSAPP.md` §6.

## Resumen de qué activar

| Prioridad | Acción | Costo |
|---|---|---|
| 🔴 Alta | Notificaciones nativas de error de Make (opción 2) | gratis |
| 🔴 Alta | Uptime externo del Worker + web (opción 3) | gratis |
| 🟡 Media | Activar el monitor Make `5567610` (opción 1) | ~14% del plan |
| 🟡 Media | Vigilar el consumo de ops de Make (opción 4) | gratis |
