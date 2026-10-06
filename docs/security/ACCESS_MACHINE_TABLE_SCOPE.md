# Alcance firmado de tablas de Máquinas

Fecha de auditoría: 2026-10-06.

## Hallazgo

El RBAC de Cloudflare Access permitía a `operator` hacer `POST/PATCH` sobre
`Maquinas`, `Maquinas_Eventos` y `Maquinas_Mant`, pero el Worker sólo
aplicaba allowlist de campos y tipos a Clientes, Cotizaciones, Pedidos y
Proveedores. Por lo tanto, una sesión firmada de operador podía caer al proxy
genérico de Airtable y enviar columnas no auditadas o creadas en el futuro.

La lectura de operador de esas tres tablas también caía al proxy genérico, por
lo que nuevas columnas quedaban visibles automáticamente y una query de Airtable
podía usarse como canal lateral para inferir datos no clasificados.

## Esquema verificado

La auditoría contrastó el código con el esquema vigente de la base
`app1YtD74AqiPWQhy` sin modificar registros.

- `Maquinas`: id, nombre, num, numG, modelo, color, ip, estado, cam y
  `WA: estado notificado`.
- `Maquinas_Eventos`: maquina_id, fecha, tipo, desc, tiempo y pedido_id.
- `Maquinas_Mant`: maquina_id, tipo, notas, print_hours, fecha y ts.

El campo `WA: estado notificado` está documentado en Airtable como administrado
por Make y no editable manualmente; queda fuera del alcance de operador.

## Política aplicada

| Tabla | Lectura operator | POST | PATCH | DELETE |
| --- | --- | --- | --- | --- |
| Maquinas | campos operativos revisados, incluida IP/cámara | no | estado, IP y cámara | no |
| Maquinas_Eventos | seis campos revisados | sí | sí, sin cambiar maquina_id | no |
| Maquinas_Mant | seis campos revisados | sí | no | no |

Las altas de eventos requieren `maquina_id`, `fecha` y `tipo`. Las altas de
mantención requieren `maquina_id`, `tipo`, `fecha` y `ts`.

La validación adicional exige:

- ID de máquina acotado y sin rutas/caracteres de escape.
- IP sólo IPv4 privada cuando se configura una impresora.
- cámara sólo por URL HTTP/HTTPS sin credenciales embebidas.
- estado de máquina dentro del catálogo operacional del dashboard.
- evento sólo `uso` o `mantencion`.
- tipo de mantención dentro del catálogo del dashboard.
- `pedido_id` vacío o record ID canónico de Airtable.
- horas no negativas y timestamp en rango razonable.
- campos desconocidos, futuros o de identidad quedan denegados por defecto.

## Defensa en profundidad

La matriz de métodos se valida tanto en `access-auth.js` como en
`worker.js`. Las mutaciones de Máquinas no se envían al Durable Object de CRM:
se validan y se proyectan en el Worker antes de usar Airtable. La respuesta se
reconstruye con el catálogo de lectura de operador para evitar que Airtable
devuelva columnas no aprobadas.

Las lecturas firmadas de operador usan el mismo lector acotado que viewer, con
un catálogo operacional ampliado. No se aceptan fórmulas, vistas, ordenamiento
arbitrario ni proyección por field ID; sólo paginación y campos expresamente
permitidos.

## Pruebas de regresión

- `tests/access-operator-mutations.test.js`
- `tests/access-operator-field-scope.test.js`

Cubren la matriz de métodos, tipos, IP, URL, estados, eventos, mantenciones,
campos futuros, el campo de WhatsApp y la redacción de respuestas.
