# Revisión del enrutamiento del guard CRM

Fecha: 2026-09-28 · Seguridad P0 · `airtable-proxy`.

## Hallazgo

El guard `CrmMutationGuard` serializa correctamente las altas que recibe
en las rutas literales `/Pedidos` y `/Cotizaciones`. Sin embargo, Airtable
también admite identificar tablas por `tblId`; según el tratamiento de las
URLs, las codificaciones equivalentes de un nombre pueden llegar a la misma
tabla sin que el Worker las reconozca como rutas protegidas. Esto permitiría
eludir la validación de unicidad recién implementada.

## Corrección

Antes de cualquier mutación de registros, el Worker valida el segmento
canónico de la tabla (`encodeURIComponent(table)`). Rechaza IDs `tbl...`,
codificaciones equivalentes no canónicas, dobles codificaciones con `%`
remanente, variantes de mayúsculas de tablas críticas y `POST` a
`Pedidos/` o `Cotizaciones/` con barras sobrantes. La interfaz existente
genera ya rutas canónicas y no necesita modificaciones adicionales.

Las pruebas `tests/crm-route-canonical.test.js` comprueban los bypasses
conocidos, el bloqueo por ausencia de Durable Object y la compatibilidad
de rutas normales como `Clientes` y `Monitor%20Sistema`.

**Riesgo residual:** esta protección no autentica a los usuarios y no
bloquea escrituras efectuadas directamente en Airtable con otra credencial.
`APP_KEY` y CORS siguen sin equivaler a control de acceso por identidad.
El cierre de seguridad requiere sesiones firmadas y autorización del
servidor por tabla, registro y operación.
