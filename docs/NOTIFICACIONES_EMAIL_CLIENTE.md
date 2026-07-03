# Correos automáticos de estado al cliente (Make + SMTP)

Automatización que **avisa por email al cliente** cuando su cotización o pedido
cambia a un estado clave: **cotización enviada → pedido en producción → listo
para despacho → despachado**. Antes de esto, el único correo automático que
recibía un cliente era el de "recibimos tu solicitud" (speed-to-lead) y la
confirmación de newsletter — nada avisaba del progreso de su cotización o
pedido; todo dependía de que alguien del equipo escribiera el correo a mano
desde la pestaña Correo del dashboard.

Construido en **Make.com** (team *My Team*, `259748`), leyendo la base
Airtable **The Lab Solutions - Operaciones** (`app1YtD74AqiPWQhy`) y enviando
por la conexión **SMTP — The Lab Solutions** (`account 8660580`), la misma que
ya usan (y prueban en producción, 0 errores) los escenarios `ALERT_AGENT
Cliente bloqueado` y `ALERT_AGENT Cotizaciones por vencer`. No depende de
Resend ni de ninguna API key nueva.

## 1. Los 4 escenarios

| ID | Nombre | Tabla | Dispara cuando | Campo dedup |
|---|---|---|---|---|
| `5561832` | Email · Cotización enviada → Cliente | Cotizaciones | `Estado cotización = Enviada` | `Email: cotización enviada` *(campo nuevo)* |
| `5561882` | Email · Pedido en producción → Cliente | Pedidos | `Estado pedido = En producción` | `Email: En producción enviado` *(ya existía)* |
| `5561885` | Email · Pedido listo para despacho → Cliente | Pedidos | `Estado pedido = Listo para despacho` | `Email: Listo para despacho enviado` *(ya existía)* |
| `5561888` | Email · Pedido despachado → Cliente | Pedidos | `Estado pedido = Despachado` | `Email: Despachado enviado` *(ya existía)* |

> **Hallazgo:** en la tabla Pedidos ya existían los campos `Email: En
> producción enviado`, `Email: Control QA enviado`, `Email: Listo para
> despacho enviado` y `Email: Despachado enviado` — provisionados pero sin
> ningún escenario que los usara. Se reutilizaron los 3 que corresponden a
> estados que el dashboard realmente asigna. `Email: Control QA enviado`
> quedó sin escenario porque el estado `Control QA` (y también `Entregado`,
> que existe como opción separada de `Despachado`) están definidos en el
> campo de Airtable pero **el dashboard nunca los asigna** — no hay código
> que mueva un pedido a esos estados hoy. Si en algún momento se empieza a
> usar `Control QA` o `Entregado` como paso real del flujo, avísame y armo
> los 2 escenarios que faltan con el mismo patrón (los campos ya están
> listos para eso).

Cada escenario sigue la misma estructura (clonada de `ALERT_AGENT Cliente
bloqueado`, que corre en producción sin errores):

**Airtable Search** (estado = X, dedup = FALSE) → **Iterator** → **Airtable Get
Record** (Cliente, para sacar su Email) → *rama con email* → **Email → Cliente**
+ **marca dedup = true** / *rama sin email* → **marca dedup = true** (sin
enviar, para no reintentar indefinidamente un cliente sin correo).

Cadencia: cada 1 hora (igual que las notificaciones WhatsApp de Cotizaciones/Pedidos).

## 2. Cambios en Airtable

- **Campo nuevo:** `Email: cotización enviada` (checkbox) en Cotizaciones
  (`fldXmiDloevF4C1iZ`) — no existía un dedup para el envío de cotización.
- Los 3 campos de Pedidos (`En producción`, `Listo para despacho`,
  `Despachado`) ya existían y no se tocaron, solo se conectaron a un escenario.

## 3. Contenido de los correos

Los 4 son HTML simple con la marca de The Lab Solutions (sin el diseño oscuro/neón
de redes — para transaccionales prima la legibilidad). Cada uno saluda al
contacto (o a la empresa si no hay contacto registrado) y muestra los datos
relevantes tomados directo de Airtable:

- **Cotización enviada:** detalle de productos, total y fecha de vencimiento.
- **En producción:** fecha de entrega estimada.
- **Listo para despacho:** fecha de entrega estimada, avisa que se coordinará el despacho/retiro.
- **Despachado:** dirección de despacho y N° de seguimiento del courier (si existen).

## 4. ⚠️ Importante: overlap con "Enviar cotización" (PDF) del dashboard

El botón **"Enviar cotización"** de la pestaña Correo ya arma un correo manual
con el PDF adjunto — pero **no toca el campo `Estado cotización`**. Si al
enviar esa cotización manual el vendedor *también* cambia el estado a
`Enviada`, el cliente recibirá **dos correos**: el manual con PDF y este
automático con el resumen en texto. Antes de activar, decide uno de estos
caminos:

1. Dejar este escenario como el único envío automático de "cotización lista"
   y que el equipo deje de usar el botón manual para ese paso (usarlo solo
   para reenvíos puntuales).
2. Mantener el botón manual como el envío real y **no activar** el escenario
   `5561832` (dejar activos solo los 3 de Pedidos).

## 5. Baseline aplicado (2026-07-03)

Igual que se hizo con las notificaciones WhatsApp, se marcaron como
"ya notificados" todos los registros que **ya estaban** en alguno de estos
4 estados al momento de crear la automatización, para que activarla no
dispare una avalancha de correos retroactivos a clientes:

- Cotizaciones en `Enviada`: **17** marcadas.
- Pedidos en `En producción`: **2** marcados.
- Pedidos en `Listo para despacho`: **1** marcado.
- Pedidos en `Despachado`: **4** marcados.

Solo lo nuevo/cambiado desde ahora generará un correo real.

## 6. Puesta en marcha (go-live)

Los 4 escenarios se crearon **inactivos a propósito**, para que los revises
antes de que le lleguen correos reales a clientes:

1. Abre cada escenario en Make y revisa el texto/asunto del módulo **Email**
   (edítalo si quieres ajustar el tono).
2. Decide el punto 4 (overlap con el envío manual de cotización).
3. Activa los que quieras dejar corriendo (`scenarios_activate` o desde la UI
   de Make → toggle ON). Recomendado: probar primero con un pedido/cotización
   de prueba con tu propio email como Cliente.
4. **Anti-duplicado:** cada escenario filtra por su checkbox de dedup y lo
   marca tras enviar. Si el envío falla, no se marca (se reintenta en la
   siguiente pasada, cada 1 h).
5. **Re-notificar manualmente:** destilda el checkbox correspondiente
   (`Email: ... enviado`) en el registro y el próximo ciclo lo vuelve a enviar.
