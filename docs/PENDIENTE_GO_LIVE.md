# Pendientes de go-live — pasos finales (2026-07-10)

> ## ✅ COMPLETADO — 100% (2026-07-10)
> Los 6 pasos quedaron hechos. Migración a Resend terminada; el dominio ya no
> manda correos automáticos por el hosting compartido de SilverHost.
> - **1. Worker desplegado** — código correcto en producción (`/health` responde 200).
> - **2. Tracking Resend** — webhook + escenario de Make activos.
> - **3. DMARC** — TXT `_dmarc` con `p=none` (subir a `quarantine` en 2–3 semanas).
> - **4. UptimeRobot** — 2 monitores (worker + web) vigilando cada 5 min.
> - **5. Plan Resend** — Free alcanza de sobra (~2 correos/día vs. tope 100/día).
>   *Vigilar bounce rate (~5.7%, apenas sobre el umbral de riesgo).*
> - **6. Respuesta a SilverHost** — enviada.

Todo lo automatizable ya quedó hecho (9 escenarios de correo migrados a Resend y
activos, con reintento anti-429; Newsletter armado; Worker blindado en el repo;
CRM limpio). Las **6 acciones** que requerían tus accesos (Cloudflare, DNS,
dashboard de Resend) ya están completadas.

> ## 🔧 Actualización (2026-07-27) — se corrigieron registros DNS duplicados
> Al re-verificar la autenticación del dominio se detectaron **duplicados** que
> hacían que Gmail/Outlook **ignoraran** la protección (el estándar descarta el
> DMARC/SPF cuando hay más de un registro):
> - **DMARC duplicado**: existían dos registros `_dmarc` (`p=quarantine` y `p=none`).
>   → Quedó **uno solo**: `v=DMARC1; p=none; rua=mailto:hola@thelab.solutions`.
> - **SPF duplicado**: existían dos `v=spf1` en la raíz (`v=spf1 a mx ~all` y el que
>   incluye SilverHost). → Quedó **uno solo**: `v=spf1 +a +mx include:_spf.silverhost.cl ~all`.
>
> Ambos verificados vía DNS-over-HTTPS (un único registro en cada consulta).
> Recordatorio automático programado para **2026-08-17**: revisar reportes DMARC y,
> si la entrega se ve bien, subir a `p=quarantine`.

---

## 1. Re-desplegar el Worker de leads
Activa la firma de Andrea en la auto-respuesta + los fixes anti-pérdida de leads.

- [ ] Abre Terminal en tu Mac.
- [ ] Corre (esto **alinea** tu copia con la del servidor, sin el error de
  "divergent branches"; todo el código bueno ya está en el servidor):
  ```
  cd ~/dashboardthelabsolutions
  git fetch origin
  git checkout claude/email-deliverability-fix-x4r726
  git reset --hard origin/claude/email-deliverability-fix-x4r726
  cd lead-worker
  npx wrangler deploy
  ```
- [ ] Confirma que el último commit sea `7763c9b` (con `git log --oneline -1`).
- [ ] Confirma que el deploy diga **"Deployed thelab-leads-worker"** y que en las
  variables aparezca `RESEND_FROM_CLIENTE: "Andrea Garrido - The Lab Solutions..."`.

> **¿Por qué `reset --hard` y no `git pull`?** Tu Mac quedó con commits viejos que
> "divergieron" de los que subí. `git pull` pide que elijas cómo mezclarlos y da el
> error que viste. Como **el código correcto y completo ya está en el servidor**
> (yo lo escribí y lo empujé), `reset --hard origin/...` simplemente hace que tu Mac
> sea idéntico al servidor. No pierdes nada tuyo: no habías escrito código local.

## 2. Tracking de Resend (aperturas / clics / rebotes → Airtable)
- [ ] En **resend.com → Webhooks → Add Endpoint**, pega la URL:
  ```
  https://hook.us2.make.com/yvji9pvbnoozrrn2eejw1eurmjpt7nfg
  ```
- [ ] Marca los eventos: `email.delivered`, `email.opened`, `email.clicked`,
  `email.bounced`, `email.complained`.
- [ ] Guarda.
- [ ] En **make.com**, abre el escenario **"The Lab — Newsletter · Tracking (Resend webhook)"**
  y ponlo en **ON** (toggle).

## 3. DMARC (reputación del dominio) — ✅ HECHO Y VERIFICADO (2026-07-27)
Registro único publicado en Cloudflare (se eliminó un duplicado que lo anulaba):

- [x] TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:hola@thelab.solutions` — verificado por DNS-over-HTTPS.
- [ ] **~2026-08-17** (si todo llega bien): subir a `p=quarantine` cambiando solo esa palabra.
  *(Recordatorio automático programado para esa fecha; avisa por push/email.)*

## 3b. SPF — ✅ HECHO Y VERIFICADO (2026-07-27)
Había **dos** registros SPF en la raíz, lo que invalidaba la validación. Quedó uno solo:

- [x] TXT raíz = `v=spf1 +a +mx include:_spf.silverhost.cl ~all` — verificado por DNS-over-HTTPS.

## 4. Monitoreo externo gratis (que nunca se caiga el formulario sin avisar)
- [ ] Entra a **uptimerobot.com** (plan gratis) → **New Monitor**.
- [ ] Tipo: **HTTP(s)**. URL:
  ```
  https://thelab-leads-worker.wast3dspa.workers.dev/health
  ```
- [ ] Intervalo: 5 min. Alerta a tu email. Guardar.

## 5. Revisar el plan de Resend
- [ ] En **resend.com → Usage**, revisa cuánto llevas.
  - Plan Free = **100 correos/día**, 3.000/mes.
  - Si te quedas corto, **Pro US$20/mes** = 50.000/mes.
- [ ] *(El 429 que vimos era tope/ráfaga; el reintento lo absorbe, pero conviene saber si llegaste al límite diario.)*

## 6. Responder a SilverHost (hosting)
- [ ] Copia el correo de **`docs/ENTREGABILIDAD_EMAIL.md`** (sección 8) y envíaselo a
  Gonzalo, confirmando que migraste los envíos automáticos a Resend y ya no salen
  por el hosting compartido.

---

## Decisión ya tomada (referencia)
- **"Cotización enviada"** quedó **activo**. Si tu equipo además manda el PDF con el
  botón manual del dashboard y cambia el estado a "Enviada", el cliente recibe 2
  correos. Recomendado: usar el botón manual **solo para reenvíos**.

## Estado de los escenarios de Make (todos por Resend, con reintento)
| Escenario | Estado |
|---|---|
| Monitor worker · Lead caliente · ALERT ×2 | 🟢 Activo |
| Pedido producción / listo / despachado | 🟢 Activo |
| Cotización enviada | 🟢 Activo (0 pendientes) |
| Backup semanal | 🟢 Activo |
| Newsletter · Envío | 🟢 Activo (armado; envía al programar campaña) |
| Newsletter · Tracking | 🟢 Activo |
