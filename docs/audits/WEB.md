# Auditoría de WEB

Fecha: 2026-08-02

## Alcance

Se revisó la sección `web` y sus vínculos con:

- tráfico del sitio mediante GA4;
- auditoría SEO del sitio Next.js;
- integración antigua con WordPress y Yoast;
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

### 1. El diagnóstico SEO altera contenido real

`runSEODiag()` escribe `__diag_test__` en `_yoast_wpseo_title` de una página publicada y no restaura el valor original.

Corrección esperada: leer y guardar el título original antes de probar, restaurarlo dentro de `finally` y reportar error si la restauración falla. Una alternativa más segura es usar un endpoint o registro de prueba no publicado.

### 2. Credenciales persistentes en el navegador

`wp_config` guarda usuario y Application Password en `localStorage`. `ads_config` guarda también el secreto de mutaciones.

Corrección esperada: migrar secretos a `sessionStorage` como mínimo o, idealmente, mover las operaciones sensibles a un Worker/backend y no entregar secretos al navegador.

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

### 10. Verificación SEO incompleta

`saveYoastFields()` considera exitoso el guardado cuando los campos existen en la respuesta, sin comparar el contenido leído con `newTitle` y `newDesc`.

Corrección esperada: comparar igualdad exacta normalizada y mostrar éxito solo después de confirmar ambos valores.

## Criterio de cierre

- El diagnóstico no deja cambios reales.
- Ningún secreto sensible queda en almacenamiento persistente ni en el bundle.
- Creación y piloto son idempotentes y transaccionales.
- El modo demo es estrictamente de solo lectura.
- Airtable no acumula duplicados por refresco.
- ROAS y capacidad se calculan con atribución y clasificación reales.
- Los diez `test.todo` pasan a pruebas activas.
- Workflow `Web audit` en verde.
