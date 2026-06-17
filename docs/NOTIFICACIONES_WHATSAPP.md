# Notificaciones por WhatsApp por vendedor (Make + WATI)

Sistema de avisos automáticos por WhatsApp para el equipo, enrutados según el
campo **Vendedor** (o el estado de máquina). Construido en **Make.com**
(team *My Team*, `259748`) leyendo la base Airtable **The Lab Solutions -
Operaciones** (`app1YtD74AqiPWQhy`) y enviando por **WATI** (la misma cuenta de
WhatsApp que ya usa el dashboard).

> Entrega "mediante un agente" = un agente automático en Make que detecta el
> cambio en Airtable, arma el mensaje y lo envía por la API de WATI al número
> de la persona asignada.

## 1. Matriz de enrutamiento

| Persona | WhatsApp | Recibe |
|---|---|---|
| **Nicanor** | +56971806142 | **Leads** + **Cotizaciones** + **Pedidos** con `Vendedor = nicanor` |
| **Gustavo** | +56988285822 | **Pedidos** + **Cotizaciones** con `Vendedor = gustavo` + **Estado de Máquinas** |
| **Florencia** | +56929830085 | **Cotizaciones** + **Pedidos** con `Vendedor = florencia` |

El teléfono se resuelve en el módulo HTTP con una fórmula `switch()` sobre el
campo Vendedor, así un mismo escenario sirve a los 3 vendedores. Leads y Estado
de Máquinas tienen un único destinatario, con el número fijo en la URL.

## 2. Disparo y anti-duplicado

- **Cuándo:** una sola vez, cuando el registro se crea o se asigna a la persona
  (máquinas: cuando cambia el `estado`).
- **Anti-duplicado:** cada escenario filtra por una casilla nueva en Airtable y
  la marca tras enviar, para no repetir. Si el envío por WATI falla, **no** se
  marca (se reintenta en la siguiente pasada).

Campos añadidos a Airtable para esto:

| Tabla | Campo nuevo | ID | Uso |
|---|---|---|---|
| Clientes (`tblKCNnXwAfDiKbQz`) | `WA: aviso asignación enviado` (checkbox) | `fldRtcBnGdIkifzQA` | dedup leads |
| Cotizaciones (`tblvVAc4TtiERA0Tc`) | `WA: aviso asignación enviado` (checkbox) | `fldVjdpV494JYCX9a` | dedup cotizaciones |
| Pedidos (`tblRXIq3RHEiMnQ0y`) | `WA: aviso asignación enviado` (checkbox) | `fldORyQ9UPRECG9ii` | dedup pedidos |
| Maquinas (`tblOv2oIlzu196XuM`) | `WA: estado notificado` (texto) | `fldMSN1nDM6nm5UKa` | guarda el último estado avisado |

> **Re-notificar / catch-up manual:** destilda la casilla `WA: aviso asignación
> enviado` de un registro (o borra `WA: estado notificado` en una máquina) y el
> próximo ciclo volverá a avisar.

**Baseline aplicado:** todos los registros existentes al 2026-06-17 quedaron
marcados como "ya notificados" (Clientes×1 nicanor, Cotizaciones×18, Pedidos×7,
Maquinas×14) para que **al activar no se dispare una avalancha** del backlog.
Sólo lo nuevo/cambiado a partir de ahora generará aviso.

## 3. Escenarios Make

Campo Vendedor por tabla: Clientes `fldT2NeOO6YjQgVns`, Cotizaciones
`flde5UJLkiJzXLd4l`, Pedidos `fldftHk62GM6kzPSt`. Estado máquina
`fld4Mi9FB4g7aWoUl`.

| ID | Nombre | Tabla | Intervalo | Filtro (fórmula Airtable) |
|---|---|---|---|---|
| `5409833` | The Lab — WhatsApp · Leads asignados → Nicanor | Clientes | 1 h | `AND({Vendedor}='nicanor', {WA: aviso asignación enviado}=FALSE())` |
| `5409848` | The Lab — WhatsApp · Cotizaciones asignadas → vendedor | Cotizaciones | 1 h | `AND({Vendedor}!='', {WA: aviso asignación enviado}=FALSE())` |
| `5409850` | The Lab — WhatsApp · Pedidos asignados → vendedor | Pedidos | 1 h | `AND({Vendedor}!='', {WA: aviso asignación enviado}=FALSE())` |
| `5409851` | The Lab — WhatsApp · Estado de Máquinas → Gustavo | Maquinas | 6 h | `({estado}&'')!=({WA: estado notificado}&'')` |

Estructura de cada escenario (clona el patrón de los escenarios de alerta ya
existentes): **Airtable Search Records → Iterator (BasicFeeder) → HTTP (WATI) →
Airtable Update Records** (marca dedup). Conexión Airtable reutilizada:
`Airtable — The Lab Solutions` (`8627122`).

Todos quedan **inactivos** a propósito (ver §5).

## 4. Envío por WATI (módulo HTTP)

Réplica de lo que ya hace el dashboard (`sendWatiMessage` en `index.html`):

```
POST {WATI_URL}/api/v1/sendSessionMessage/{telefono}
Headers: Authorization: Bearer {WATI_TOKEN}
         Content-Type: application/json
Body:    {"messageText":"...texto del aviso..."}
```

Teléfonos sin `+` ni símbolos: Nicanor `56971806142`, Gustavo `56988285822`,
Florencia `56929830085`.

### ⚠️ Placeholders a reemplazar (faltan credenciales)
Las credenciales WATI viven hoy sólo en el navegador (localStorage), no en Make.
En el módulo **HTTP** de cada escenario hay que reemplazar:

- URL host `https://live-server-PLACEHOLDER.wati.io` → **URL real del servidor WATI**.
- Header `Authorization: Bearer PEGAR_TOKEN_WATI` → **token real de WATI**.

(Lo mismo que aparece en Dashboard → ⚙ WATI: "URL del servidor" y "Token Bearer".)

## 5. Puesta en marcha (go-live)

1. **Cargar credenciales WATI** en los 4 escenarios (reemplazar los 2
   placeholders del módulo HTTP de cada uno). Atajo sin compartir el token por
   chat: en el dashboard, **⚙ WATI → Guardar** (escribe el registro
   `WATI_CONFIG` en la tabla *Monitor Sistema* de Airtable); luego se leen esas
   credenciales y se rellenan los escenarios.
2. **Despausar la organización** de Make — hoy está en pausa
   (`org 2450620 isPaused: true`); sin esto nada corre.
3. **Activar** los 4 escenarios (`5409833`, `5409848`, `5409850`, `5409851`).
4. Probar: asigna un Vendedor a una cotización de prueba (o destilda su casilla)
   y verifica que llega el WhatsApp.

### Recomendado: plantilla aprobada (entrega 24/7)
`sendSessionMessage` sólo entrega si la persona **escribió al número WATI en las
últimas 24 h**. Para avisos proactivos garantizados, aprobar una plantilla
(utility) en WATI/Meta y cambiar el HTTP a `sendTemplateMessage`. Mientras tanto,
que cada persona mantenga abierta la conversación con el bot, o se aprueba la
plantilla.

## 6. Costo de operaciones (plan Core: 10.000 ops/mes) — IMPORTANTE

⚠️ **La organización ya consumió sus 10.000 ops del ciclo** (`unusedOperations: 0`)
y por eso está pausada. Reinicia el **2026-06-21**. Hasta entonces (o hasta subir
de plan / comprar ops) **nada corre**.

Cada pasada que no encuentra registros consume ~1 op. Con los intervalos actuales:
Leads 1 h (~720/mes) + Cotizaciones 1 h (~720) + Pedidos 1 h (~720) + Máquinas 6 h
(~120) ≈ **~2.280 ops/mes** de base, más ~2 ops por cada aviso real. Súmalo a lo
que ya consumen los 6 escenarios activos previos.

Para no volver a topar el límite, dos caminos:
1. **Subir intervalos** (p. ej. todo a 2–4 h) o subir de plan en Make.
2. **Migrar a event-driven (recomendado):** crear *Automatizaciones de Airtable*
   (una por tabla, "cuando un registro coincide" → "enviar webhook") que apunten a
   **un** webhook de Make que enruta por entidad + Vendedor y envía por WATI.
   Consumo ~0 en reposo y entrega casi instantánea; deja el polling como respaldo.
   (Las automatizaciones se crean en la UI de Airtable; el webhook de Make lo puedo
   dejar armado cuando quieras.)
