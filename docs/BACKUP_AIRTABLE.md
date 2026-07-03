# Backup semanal de Airtable (Make + Email)

Airtable es la **única base de datos del negocio** (clientes, cotizaciones,
pedidos, finanzas) y hasta ahora no tenía ningún respaldo automático: si alguien
borra una tabla, corrompe datos o se pierde el acceso a la cuenta, no había
forma de recuperar. Este escenario crea un **snapshot semanal recuperable**.

## Escenario

| ID | Nombre | Cadencia | Estado |
|---|---|---|---|
| `5562653` | The Lab — Backup semanal Airtable → Email | Lunes 06:00 | **inactivo** (revisar y activar) |

**Flujo:** Airtable Search (Clientes) + Airtable Search (Cotizaciones) + Airtable
Search (Pedidos), hasta 1000 registros c/u → **Email** con el volcado de las 3
tablas al buzón `thelabsolutionscl@gmail.com` (conexión SMTP `8660580`, la misma
de las alertas internas). Cada correo queda como una copia con fecha, buscable en
Gmail.

## ⚠️ Verificar antes de confiar en él

El cuerpo del correo embebe los registros con `{{1.records}}` / `{{2.records}}` /
`{{3.records}}`. **Antes de activarlo, pruébalo una vez** para confirmar que el
volcado es legible y no un placeholder tipo `[Collection]`:

1. En Make, abre el escenario `5562653`.
2. Botón **"Run once"** (▶ abajo a la izquierda).
3. Revisa el correo que llega a `thelabsolutionscl@gmail.com`: dentro de los
   bloques `<pre>` debe verse el contenido real de cada registro (nombres,
   emails, montos), no `[Collection]`/`[Array]`.
4. **Si se ve bien** → activa el escenario (toggle ON). Listo.
5. **Si se ve como placeholders** → hay que cambiar el volcado a **adjuntos CSV**
   (módulo *Aggregate to CSV* → adjuntar al email). Avísame y lo ajusto, o hazlo
   en la UI: entre cada Search y el Email, agrega un *Iterator* sobre `records` y
   un *Text/CSV aggregator*.

## Recomendaciones de robustez (opcional)

- **Off-site real:** el correo a Gmail es un respaldo liviano. Para algo más
  serio, cambiar el destino a un *Google Drive → Upload file* (CSV/JSON con
  fecha en el nombre) o a un bucket. Así queda versionado fuera de Airtable y de
  Make.
- **Ampliar tablas:** hoy respalda las 3 núcleo. Si quieres incluir
  `Newsletter_Campañas`, `Agent_Queue`, `Facturas`/`FINANZAS - Ventas`, etc.,
  agrega más módulos Search al mismo escenario.
- **Retención:** en Gmail, una etiqueta/filtro "Backups The Lab" ayuda a no
  perderlos entre el resto del correo.
- **No commitear los datos:** nunca guardar el volcado en este repo — se publica
  entero en GitHub Pages (ver `deploy.yml`, sube `path: .`), es decir, sería
  público. El backup debe vivir en el correo/Drive, nunca en git.
