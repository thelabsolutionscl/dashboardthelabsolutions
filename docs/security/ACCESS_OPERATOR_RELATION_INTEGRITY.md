# Integridad referencial de mutaciones CRM de operator

Fecha de auditoría: 2026-10-06.

## Hallazgo

El catálogo de mutaciones de `operator` validaba que los campos linked-record
tuvieran IDs canónicos `rec...`, pero eso sólo valida el formato. Antes de
esta corrección no se comprobaba que:

- el Cliente existiera realmente en `Clientes`;
- una Cotización y su Pedido pertenecieran al mismo Cliente;
- las Cotizaciones enlazadas desde un Pedido pertenecieran al mismo Cliente;
- una Cotización ya asignada a un Pedido no se reutilizara para crear otro;
- una mutación PATCH no moviera una Cotización ya enlazada a otro Pedido;
- una mutación PATCH de Pedido no desprendiera Cotizaciones ya asociadas.

El riesgo era de integridad, no de lectura: una sesión `operator` válida podía
fabricar relaciones CRM lógicamente imposibles aunque todos los IDs tuvieran un
formato Airtable correcto.

## Verificación de datos vigentes

Se contrastó la regla contra Airtable en modo sólo lectura antes de activarla:

- 314 Clientes;
- 71 Cotizaciones;
- 33 Pedidos;
- 0 Cotizaciones con cardinalidad de Cliente inválida;
- 0 Pedidos con cardinalidad de Cliente inválida;
- 0 cruces Cliente/Cotización/Pedido con clientes distintos;
- 0 enlaces inversos Cotización↔Pedido incoherentes.

Por lo tanto, la política nueva coincide con los datos vigentes y no requiere
migración histórica.

## Política aplicada

Las comprobaciones viven dentro del Durable Object global de CRM, no sólo en el
Worker exterior. De este modo una llamada interna al guard tampoco puede saltar
la validación.

### CREATE Cotizaciones

- requiere exactamente un Cliente existente;
- Pedido es opcional y como máximo uno;
- si se incluye Pedido, su Cliente debe coincidir.

### CREATE Pedidos

- requiere exactamente un Cliente existente;
- todas las Cotizaciones enlazadas deben existir y pertenecer a ese Cliente;
- una Cotización ya asignada a otro Pedido no puede reutilizarse.

### PATCH Cotizaciones

La verificación sólo se activa cuando cambia `Cliente` o `Pedido`.

- se relee la relación actual;
- el estado final debe conservar exactamente un Cliente existente;
- Cliente y Pedido deben coincidir;
- `operator` no puede mover ni desprender una Cotización que ya tenga Pedido.

### PATCH Pedidos

La verificación sólo se activa cuando cambia `Cliente` o `Cotizaciones`.

- se relee el Pedido actual;
- el estado final debe conservar exactamente un Cliente existente;
- toda Cotización final debe pertenecer a ese Cliente;
- no se pueden quitar Cotizaciones ya asociadas;
- sólo se pueden añadir Cotizaciones libres o ya enlazadas a ese mismo Pedido.

Correcciones administrativas excepcionales siguen perteneciendo a roles
privilegiados; no se habilita un bypass genérico para operator.

## Fallo cerrado

Las búsquedas de relaciones son server-generated: el cliente no controla
fórmulas ni tablas de lookup. Si Airtable no responde, pagina inesperadamente,
devuelve filas malformadas o no permite verificar todos los IDs, la mutación no
se envía y responde con `CRM_RELATION_VERIFY_UNAVAILABLE`.

IDs inexistentes o relaciones incompatibles responden con
`CRM_RELATION_INVALID`. Un PATCH de una fuente inexistente responde con
`CRM_RELATION_SOURCE_MISSING`.

Las mutaciones sin cambios de relaciones no añaden lecturas extra de Airtable.

## Limitación conocida

El Durable Object serializa las mutaciones que pasan por este proxy, pero una
edición externa directa en Airtable/Make puede ocurrir entre el preflight y la
escritura. Esta corrección evita relaciones inválidas al momento de autorizar la
mutación; la coordinación completa de writers externos sigue siendo parte del
rollout de Access.

## Pruebas

- `tests/access-operator-relations.test.js`
- `tests/access-operator-mutations.test.js`
