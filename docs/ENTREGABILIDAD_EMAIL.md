# Entregabilidad de correo — migración del SMTP compartido a Resend

> **Origen:** el proveedor de hosting (SilverHost) avisó que detectó un volumen
> elevado de correos automáticos saliendo de `hola@thelab.solutions` por el
> servidor **compartido**, y que eso arriesga la reputación de la IP compartida,
> la clasificación como spam y —si sigue— **restricciones de envío al hosting**.
> Este documento es el diagnóstico y el plan para migrar esos envíos a una
> plataforma transaccional (**Resend**), tal como recomienda el proveedor.

Fecha de análisis: **2026-07-09**.

---

## 1. Diagnóstico — de dónde salen los correos

El problema **no está en el sitio (Vercel/GitHub Pages) ni en `mail-api.php`**.
`mail-api.php` es el webmail manual del dashboard (pestaña Correo): solo envía
cuando una persona aprieta "Enviar", es bajo volumen y no es la causa.

El volumen de **notificaciones automáticas** sale de **Make.com** a través de una
única conexión SMTP del hosting compartido:

- **Make → conexión `8660580` = "My Others (SMTP)" → `SMTP hola@thelab.solutions`**
  (es decir, `mail.thelab.solutions:465`, el servidor compartido de SilverHost).

Esa conexión la usan **9 escenarios**. Los que envían a **clientes externos** son
los que más golpean la reputación (rebotes, quejas de spam):

| Escenario (ID) | Destino | Antes | Frecuencia |
|---|---|---|---|
| Email · Cotización enviada → Cliente (`5561832`) | cliente | activo | cada 2 h |
| Email · Pedido despachado → Cliente (`5561888`) | cliente | activo | cada 2 h |
| Email · Pedido en producción → Cliente (`5561882`) | cliente | inactivo | cada 2 h |
| Email · Pedido listo para despacho → Cliente (`5561885`) | cliente | inactivo | cada 2 h |

Y los **internos** (avisos al equipo), que también salían por el mismo SMTP:

| Escenario (ID) | Destino | Antes | Frecuencia |
|---|---|---|---|
| ALERT_AGENT Cliente bloqueado (`4930454`) | `thelabsolutionscl@gmail.com` | activo | cada 6 h |
| ALERT_AGENT Cotizaciones por vencer (`4931482`) | `thelabsolutionscl@gmail.com` | activo | cada 6 h |
| Lead caliente (score ≥ 8) → aviso (`5399550`) | interno | activo | cada 6 h |
| Monitor · Worker de leads (health check) (`5567610`) | `thelabsolutionscl@gmail.com` | activo | cada 1 h |
| Backup semanal Airtable → Email (`5562653`) | `thelabsolutionscl@gmail.com` | inactivo | lunes 06:00 |

> El **speed-to-lead**, la **confirmación de newsletter** y el **envío del
> newsletter** ya salen por **Resend** (HTTP), no por el SMTP compartido. Ese es
> el patrón correcto y el que replicamos aquí.

---

## 2. Acción inmediata ya aplicada (2026-07-09) — frenar la sangría

Se **desactivaron en Make** los 6 escenarios que estaban **activos** enviando por
el SMTP compartido, para cortar el volumen de inmediato:

- `5561832` Email · Cotización enviada → Cliente
- `5561888` Email · Pedido despachado → Cliente
- `4930454` ALERT_AGENT Cliente bloqueado
- `4931482` ALERT_AGENT Cotizaciones por vencer
- `5399550` Lead caliente (score ≥ 8) → aviso
- `5567610` Monitor · Worker de leads (health check)

Los otros 3 (`5561882`, `5561885`, `5562653`) ya estaban inactivos. **A partir de
ahora no sale ningún correo automático por el hosting compartido.**

## 2.bis Migración a Resend YA APLICADA (2026-07-09)

Se migraron **8 de los 9 escenarios** del SMTP compartido a **Resend (HTTP)**,
directo en Make. En cada uno se reemplazó el módulo **Email (SMTP)** por dos
módulos: **Create JSON** (arma el cuerpo escapando los valores, a prueba de
comillas) → **HTTP** (`POST https://api.resend.com/emails`). Se creó una
estructura de datos reutilizable **"Resend Email Payload"** (`id 423714`).

| Escenario | ID | Estado tras migrar |
|---|---|---|
| Email · Cotización enviada → Cliente | `5561832` | migrado · **inactivo** |
| Email · Pedido en producción → Cliente | `5561882` | migrado · **inactivo** |
| Email · Pedido listo para despacho → Cliente | `5561885` | migrado · **inactivo** |
| Email · Pedido despachado → Cliente | `5561888` | migrado · **inactivo** |
| ALERT_AGENT Cliente bloqueado | `4930454` | migrado · **inactivo** |
| ALERT_AGENT Cotizaciones por vencer | `4931482` | migrado · **inactivo** |
| Lead caliente (score ≥ 8) → aviso | `5399550` | migrado · **inactivo** |
| Monitor · Worker de leads (health check) | `5567610` | migrado · **inactivo** |

> **Falta 1:** `5562653` (Backup semanal Airtable → Email) sigue en el SMTP
> compartido pero está **inactivo**; embebe un volcado enorme de Airtable, así que
> se deja para migrar aparte (o pasar a la conexión Gmail). No envía a clientes.

**Los 8 quedaron INACTIVOS a propósito**: falta pegar la API key de Resend
(sección 4.2) y probar antes de reactivar. El `from` de todos es
`hola@thelab.solutions` (dominio ya verificado en Resend).

> ⚠️ Consecuencia temporal: hasta que pegues la key y reactives, el equipo **no**
> recibe los avisos internos ni los clientes los de estado. Es el último paso.

---

## 3. Requisito previo (bloquea todo): verificar el dominio en Resend

Para que Resend pueda enviar **como `hola@thelab.solutions`** hay que verificar el
dominio con registros DNS. Es **gratis** y es el **paso 0** de la migración.

1. En **Resend → Domains → Add Domain** → `thelab.solutions`.
2. Resend entrega **los valores exactos** de estos registros (cópialos tal cual;
   no los inventes):
   - **SPF** — un `TXT` en el subdominio de envío (`send.thelab.solutions`),
     típicamente `v=spf1 include:amazonses.com ~all`.
   - **DKIM** — un `TXT`/`CNAME` en `resend._domainkey` con la clave pública.
   - **MX** — un `MX` en `send` (para procesar rebotes/feedback).
   - **DMARC** (recomendado) — un `TXT` en `_dmarc.thelab.solutions`, p. ej.
     `v=DMARC1; p=none; rua=mailto:hola@thelab.solutions`.
3. Pega esos registros en el **panel DNS de `thelab.solutions`** (donde
   administres el DNS del dominio).
4. En Resend, pulsa **Verify**. Cuando quede **"Verified"**, sigue con la sección 4.

> Ya existe una **API key de Resend** en uso (el Worker de leads la tiene como
> secreto `RESEND_API_KEY`). La misma cuenta/API key sirve para Make. Si no la
> tienes a mano, crea una nueva en **Resend → API Keys**.

> **Nota:** el speed-to-lead del Worker ya envía desde `@thelab.solutions` por
> Resend. Si el dominio **no** estaba verificado, esos correos podrían haber
> estado fallando en silencio — verificarlo también arregla eso.

---

## 4. Cómo terminar (pegar API key → probar → activar)

La migración **ya está hecha** (sección 2.bis). Falta solo esto, una vez por
escenario (8 en total):

1. **Pegar la API key de Resend.** Abre el escenario en Make → módulo **HTTP** →
   header `Authorization` → reemplaza `Bearer re_PEGA_AQUI_TU_API_KEY_DE_RESEND`
   por `Bearer re_<tu_api_key_real>` (créala en Resend → *API Keys* si no la tienes).
2. **Probar con "Run once"** con un registro de prueba (una cotización/pedido con
   tu propio email como Cliente, o forzando la condición) y confirma que el correo
   llega bien y con el diseño correcto.
3. **Activar** el escenario (toggle ON).

> El `data` del módulo HTTP es `{{4.json}}` (o `{{3.json}}`/`{{2.json}}` según el
> escenario): el módulo **Create JSON** previo arma el cuerpo y **escapa los
> valores automáticamente**, por lo que un campo con comillas o saltos de línea
> (ej. "Detalle" o texto de IA) ya no rompe el envío.

### 4.1 Config del módulo HTTP (referencia — ya aplicada)

```jsonc
{
  "url": "https://api.resend.com/emails",
  "method": "POST",
  "headers": [
    { "name": "Authorization", "value": "Bearer re_PEGA_AQUI_TU_API_KEY_DE_RESEND" },
    { "name": "Content-Type",  "value": "application/json" }
  ],
  "bodyType": "raw",
  "contentType": "application/json",
  "body": "{ \"from\": \"The Lab Solutions <hola@thelab.solutions>\", \"to\": [\"<EMAIL_DESTINO>\"], \"reply_to\": \"hola@thelab.solutions\", \"subject\": \"<ASUNTO>\", \"html\": \"<HTML>\" }"
}
```

- **`Authorization`**: pega tu API key real de Resend (empieza con `re_`) en el
  editor de Make. **No** la pongas por chat ni la commitees al repo.
- **`from`**: `The Lab Solutions <hola@thelab.solutions>` (o `contacto@…`).
- **`to`**, **`subject`**, **`html`**: se mapean con las mismas variables que ya
  tenía el módulo Email de cada escenario (el `{{...}}` de Airtable). Al construir
  el módulo en el editor, arrastra los campos igual que antes.

### 4.2 Escenarios a cliente (plantilla HTML grande)

`5561832`, `5561882`, `5561885`, `5561888`. En cada uno:

1. Abre el escenario en Make.
2. Reemplaza el módulo **Email (SMTP — The Lab Solutions)** por el módulo **HTTP**
   de 4.1, conservando el **filtro** ("Cliente con email") y el mapeo de `to`,
   `subject` y `html` (copia el HTML de la plantilla actual tal cual).
3. **No toques** los módulos de Airtable de dedup (`Email: … enviado`): siguen
   marcando el checkbox tras enviar, igual que antes.
4. **Run once** con una cotización/pedido de prueba con **tu propio email** como
   Cliente y confirma que el correo llega bien y con el diseño correcto.
5. Recién ahí **activa** el escenario.

### 4.3 Escenarios internos (HTML corto)

`4930454`, `4931482`, `5399550`, `5567610`, `5562653`. Misma conversión.
Como el destinatario es interno (`thelabsolutionscl@gmail.com`), hay **dos
opciones**:

- **(a) Resend** — igual que 4.2 (requiere el dominio verificado, sección 3).
- **(b) Conexión Gmail existente** (`8662006`, ya autenticada) — reemplaza el
  módulo Email (SMTP) por **Gmail → Send Email**. Ventaja: **no** depende de la
  verificación del dominio, así que estos avisos internos pueden volver a
  funcionar **de inmediato**. El "from" pasa a ser la cuenta Gmail, lo cual es
  aceptable para avisos internos.

> Recomendación: para los internos usa **(b) Gmail** y reactívalos ya (recuperas
> el monitor de worker caído y las alertas del equipo sin esperar el DNS). Para
> los de cliente usa **(a) Resend** una vez verificado el dominio.

---

## 5. Checklist de go-live

- [x] Cortar el envío por el SMTP compartido (6 escenarios desactivados).
- [x] Verificar `thelab.solutions` en Resend (SPF/DKIM/MX/DMARC) — **Verified**.
- [x] Migrar los 8 escenarios (4 cliente + 4 internos) a Create JSON → Resend.
- [ ] Pegar la API key de Resend en el header `Authorization` de cada uno (8).
- [ ] **Run once** de prueba en cada escenario y confirmar que el correo llega.
- [ ] **Activar** los escenarios (los 6 que estaban corriendo, y los de cliente
      que quieras dejar automáticos).
- [ ] (Pendiente aparte) Migrar el Backup semanal `5562653` (o pasarlo a Gmail).
- [ ] (Opcional) Configurar el webhook de tracking de Resend del escenario
      `5439094` para medir entregas/rebotes.
- [ ] Responder a SilverHost confirmando que los envíos automáticos migraron a
      Resend y ya no salen por el hosting compartido.

## 6. Costo

- **Resend**: plan Free = 3.000 correos/mes (100/día). El tráfico transaccional
  del negocio está muy por debajo → **US$0**. Si algún día se supera, Pro = US$20/mes.
- **Make / Gmail / DNS**: **US$0** adicional. Cambiar el módulo no cambia el
  consumo de operaciones de Make.

## 7. Qué NO cambia

- **`mail-api.php`** (webmail manual del dashboard): se queda igual. Es envío
  manual, 1:1, de bajo volumen. **Recomendación:** no automatizar envíos masivos
  a través de él (seguiría usando el SMTP compartido).
- El **envío de prueba del newsletter** (`nlSendTest`) usa `mail-api.php`; es un
  único correo a tu propia casilla, no es volumen. El envío **masivo** ya va por
  Resend (Make).
