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
