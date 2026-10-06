# Auditoría de WEB

Fecha: 2026-08-02

## Alcance

Se revisó la sección `web` y sus vínculos con:

- tráfico del sitio mediante GA4;
- auditoría SEO del sitio Next.js;
- Google Ads y Apps Script;
- campañas, anuncios, keywords y términos de búsqueda;
- capacidad de producción;
- cola de mutaciones y Script 2;
- Airtable;
- piloto automático con aprobación;
- conversiones offline desde Clientes y Pedidos.

## Orden lógico verificado

1. La sección muestra primero el tráfico del sitio.
2. `loadAdsData()` obtiene y valida la respuesta del endpoint.
3. La misma respuesta alimenta KPIs, campañas, agente Ads, capacidad y sugerencias.
4. Se carga GA4 dentro del mismo ciclo.
5. Se muestra la cola local y luego se concilia con Script 2.
6. Después aparecen las propuestas pendientes del piloto automático.
7. El snapshot validado se envía a Airtable.
8. Las conversiones offline salen de Clientes/Pedidos con GCLID, valor neto y zona horaria de Santiago.

## Cobertura automática

- `tests/web-wiring.test.js`
- `.github/workflows/web-audit.yml`

La prueba protege navegación, IDs, funciones únicas, orden de carga, auditor SEO, propuestas IA, validación de campañas, cola, conciliación, capacidad productiva, piloto, conversiones offline y snapshots.

## Hallazgos pendientes

### 1. Auditor SEO actual de Next.js

El diagnóstico del sitio funciona sobre su sitemap real y el proxy de lectura, sin conexión a CMS antiguo ni modificación de páginas. La integración retirada y sus credenciales se purgan de ambos almacenamientos del navegador.

### 2. Secreto de mutaciones de Google Ads

El secreto Ads se conserva como máximo en la sesión; las operaciones sensibles deben pasar a servicios backend con autenticación y no quedar en el bundle.

### 3. Webhook de Make y clave expuestos

`ADS_MAKE_SHELL` contiene una URL de webhook y una clave dentro del bundle público.

Corrección esperada: usar un endpoint autenticado del Worker. El navegador debe enviar una solicitud autorizada y el servidor debe conservar la URL y el secreto de Make.

### 4. Orden transaccional incorrecto al crear campañas

`saveCampaignMutation()` solicita primero el cascarón a Make y luego encola la mutación. Si la cola o el secreto fallan, puede quedar una campaña real incompleta.

Corrección esperada: confirmar primero una orden persistida y aceptada, y que un único servicio servidor cree el cascarón y complete la campaña de forma idempotente.

### 5. Modo demo con acciones reales disponibles

Cuando falla el endpoint por defecto, `loadAdsData()` muestra datos demo. Las sugerencias y botones de creación continúan disponibles y pueden alcanzar el webhook real de Make.

Corrección esperada: bloquear edición, creación, eliminación, negativos y piloto cuando `data.demo === true`. Mostrar un banner permanente y no solo un punto de estado.

### 6. Duplicación de snapshots en Airtable

`syncAdsToAirtable()` usa `POST` en cada actualización. Refrescar varias veces en un día crea múltiples KPIs y múltiples registros por campaña y fecha.

Corrección esperada: upsert por `Customer ID + Fecha + Días período` para KPIs y por `Campaign ID + Fecha snapshot + Período` para campañas.

### 7. “ROAS real” sin atribución

`adsSaveSnapshot()` divide todo el revenue de pedidos del período por el gasto de Google Ads. Incluye clientes orgánicos, referidos y otros canales.

Corrección esperada: atribuir mediante GCLID, UTMs o fuente de lead y nombrar la métrica como “Revenue CRM total / gasto Ads” mientras no exista atribución confiable.

### 8. Capacidad manual y láser usa backlog global

`getCapacidadLineas()` asigna el mismo porcentaje calculado desde todos los pedidos activos a cartelería, láser, premiaciones, merchandising y papelería.

Corrección esperada: clasificar cada pedido por línea de producto y medir carga/capacidad por línea. No pausar campañas por pedidos de otra categoría.

### 9. Aprobación del piloto no es atómica

`adsAutopilotDecide()` encola las mutaciones y después intenta marcar la propuesta como completada. El error de Airtable se ignora.

Corrección esperada: reservar la propuesta primero (`Procesando` con versión o compare-and-set), encolar una sola vez y cerrar como completada. Ante fallo, restaurar el estado o dejar un error recuperable.

### 10. Integraciones del sitio actual

Mantener pruebas de la auditoría SEO Next.js y Google Ads sin reintroducir clientes de CMS obsoletos.

## Criterio de cierre

- El diagnóstico no deja cambios reales.
- Ningún secreto sensible queda en almacenamiento persistente ni en el bundle.
- Creación y piloto son idempotentes y transaccionales.
- El modo demo es estrictamente de solo lectura.
- Airtable no acumula duplicados por refresco.
- ROAS y capacidad se calculan con atribución y clasificación reales.
- Los `test.todo` vigentes se convierten progresivamente en pruebas activas; se retiraron los casos exclusivos del CMS eliminado.
- Workflow `Web audit` en verde.


## Seguridad del fetch SEO (2026-09-28)

El backend `airtable-proxy /seo-fetch` ahora resuelve redirecciones manualmente
para no seguir enlaces desde `thelab.solutions` hacia orígenes ajenos.
Solo admite HTTPS al dominio canónico o su variante `www`; corta a
4 solicitudes y 2 MiB de HTML. No realiza fetch a terceros aunque el
primer enlace sea legítimo. Regresión automatizada: `tests/seo-proxy-ssrf.test.js`.

## 2026-09-29 — control de credenciales y modo demo (PR #319)

- El secreto de Google Ads se migra de `localStorage` a `sessionStorage`. El almacenamiento persistente de `ads_config` conserva solamente endpoint y Customer ID.
- El modo demo aplica también cuando un dashboard real cae a datos de ejemplo
  por fallo del endpoint. Un aviso permanente indica **SOLO LECTURA**, y se
  bloquean creación/edición/eliminación de campañas, mutaciones en cola,
  presupuesto, negativos, reintentos y aprobaciones de piloto. Los snapshots
  de Airtable nunca se escriben desde datos de demostración.
- Las credenciales del CMS antiguo fueron retiradas del código y ahora se purgan tanto de `localStorage` como de `sessionStorage` al cargar el dashboard. Ninguna contraseña de terceros se rota automáticamente. El webhook y la
  clave de `ADS_MAKE_SHELL` continúan expuestos por compatibilidad con la ruta
  de creación existente; deben sustituirse por un puente servidor y rotarse en
  un corte coordinado, sin romper campañas en curso.

## 2026-09-29 — Retiro de componentes sin uso

Se eliminó íntegramente la integración anterior del CMS, sus modales, rutas de escritura, fixtures de modo demo, KPI huérfanos y pruebas obsoletas. El auditor SEO del sitio Next.js y Google Ads se mantienen y son los únicos flujos web vigentes.

## 2026-10-06 — cierre de seguridad, idempotencia y atribución de Google Ads

La reauditoría del código vigente confirmó que varios pendientes del 29 de
septiembre seguían activos y que algunos ya tenían impacto real sobre los datos.

### Credenciales y frontera de confianza

- Se retiraron del bundle público la URL/clave de `ADS_MAKE_SHELL`.
- El secreto de mutaciones de Google Ads ya no se migra a `sessionStorage`:
  cualquier copia heredada de `ads_mutation_secret` se elimina al cargar.
- El formulario deja de pedir o mostrar el secreto. El navegador conserva
  solamente la URL de lectura y el Customer ID.
- Las escrituras pasan por rutas firmadas del Proxy Worker:
  `POST /ads/mutation`, `GET|PUT /ads/mutations`,
  `POST /ads/snapshot` y `POST /ads/autopilot/decision`.
- Todas requieren una identidad individual de Cloudflare Access con rol
  `admin`; la APP_KEY compartida por sí sola no autoriza ningún cambio Ads.

Las credenciales reales se leen exclusivamente del entorno del Worker:
`ADS_MUTATION_URL`, `ADS_MUTATION_SECRET`, `ADS_MAKE_SHELL_URL` y
`ADS_MAKE_SHELL_KEY`.

### Creación de campañas e idempotencia

Una creación ya no llama a Make desde el navegador. El guard serializado:

1. reserva la mutación;
2. confirma que Script 1 la aceptó;
3. recién entonces solicita el cascarón a Make;
4. guarda un marcador persistente para impedir un segundo envío.

Si se pierde la respuesta del Apps Script o de Make, el resultado queda como
reconciliación pendiente y se bloquea el reintento ciego. Un doble clic o dos
sesiones con la misma mutación no deben crear dos órdenes ni dos cascarones.

### Snapshots sin nuevos duplicados

La lectura de Airtable del 6 de octubre de 2026 confirmó duplicados históricos:
hay claves KPI diarias repetidas (una de ellas hasta 14 veces) y snapshots de
campaña repetidos (hasta 7 veces en una misma clave observada).

El nuevo guard usa upsert por:

- KPI: `Customer ID + Fecha + Días período`;
- campaña: `Campaign ID + Fecha snapshot + Período (días)`.

Si ya existe una fila, actualiza de forma determinista la más reciente; si hay
duplicados heredados, devuelve su cantidad pero **no los elimina**. Si un POST
nuevo tiene resultado incierto, deja una reserva persistente y no crea otro.

### ROAS CRM con atribución

Se eliminó la métrica engañosa que dividía todo el revenue de la empresa por el
gasto de Google Ads. El panel y los snapshots locales ahora suman solo clientes
con evidencia de origen Ads: GCLID, Campaña Ads u origen explícito
`google_ads` / `Google Ads`. Un origen genérico “Google” no se convierte en
pauta pagada.

Los nombres visibles pasan a “Ingresos atribuidos Ads”, “ROAS CRM atribuido” y
“Costo por Lead Ads”. La métrica sigue siendo una atribución CRM basada en la
evidencia disponible, no una reconciliación contable de caja.

### Capacidad por línea

Cartelería/Láser y líneas manuales ya no heredan el porcentaje de todos los
pedidos activos. Los pedidos se clasifican usando notas y ficha del pedido,
texto/detalle de la cotización vinculada y, como respaldo, `Servicio interés`
del cliente. Los pedidos no clasificables se muestran como tales y no se
cargan artificialmente a todas las líneas.

FDM conserva la capacidad basada en slots reales de impresoras y mantenimiento.

### Piloto automático

La decisión de aprobar/rechazar sale del navegador como una única operación
firmada. El servidor vuelve a leer `Agent_Queue`, marca la propuesta
`Procesando` antes de encolar, reutiliza el mismo guard idempotente de
mutaciones y solo marca `Completado` después de confirmar todas. Ante una
falla parcial vuelve a `Pendiente` con un error recuperable; los envíos ya
confirmados son idempotentes al reintentar.

### Pendiente operativo deliberadamente diferido

No se reintroducen secretos al cliente para activar el flujo. En la ventana
manual final de la auditoría general se debe:

- configurar los cuatro secretos Ads del Worker;
- activar/verificar Cloudflare Access y el rol admin;
- rotar el antiguo secreto de mutaciones y la antigua clave del webhook de
  Make, porque estuvieron expuestos históricamente en el bundle;
- revisar el historial de ejecuciones de Make por uso inesperado;
- validar con dos sesiones que un admin puede operar y otros roles quedan
  bloqueados;
- conciliar, si se desea, los duplicados históricos ya existentes en Airtable.

Hasta ese corte el nuevo flujo de escritura falla cerrado; la lectura/demostración
no debe volver a publicar secretos para “mantener compatibilidad”.
