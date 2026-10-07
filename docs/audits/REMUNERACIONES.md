# Auditoría de REMUNERACIONES

## Estado

Auditoría funcional #106 cerrada en código.

El módulo deja de tratar todo pedido despachado como una “comisión ganada” y separa explícitamente:

- estimación comercial;
- comisión devengada;
- comisión aprobada;
- comisión pagada;
- reversas;
- pipeline ponderado.

La vista histórica en `index.html` permanece como compatibilidad, pero el cálculo autoritativo se instala desde `js/remuneraciones-engine.js` al cargar `js/finanzas.js`.

## Motor de cálculo

### Reglas versionadas

La regla estándar queda representada como una entidad versionada con:

- `id`;
- `version`;
- vendedor/email;
- tasa;
- base (`net_tax_document`, `net_paid` o `net_invoiced`);
- vigencia desde/hasta;
- contrato;
- producto.

La tasa ya no es una constante repetida dentro del motor autoritativo.

### Base tributaria

El motor no transforma un bruto en neto dividiendo siempre por 1,19.

Acepta únicamente una base tributaria explícita:

- neto/subtotal neto; o
- bruto menos IVA explícito.

Si no existe esa evidencia, la base queda como no verificada y la cifra se mantiene en estado estimado.

### Cobro, pagos parciales y reversas

- una factura/DTE con base tributaria puede devengar comisión;
- una regla `net_paid` prorratea por el porcentaje realmente pagado;
- un pago total cambia el evento a `paid`;
- notas de crédito, devoluciones, anulaciones o reversas generan monto negativo;
- si existe un monto neto explícito de reversa parcial se usa ese monto y no el total del pedido.

## Pipeline

Las cotizaciones vencidas ya no aportan potencial pleno.

Ponderación vigente:

- Solicitada: 35 %;
- Enviada: 65 %;
- Aprobada: 90 %;
- vencida: 0 %.

La interfaz lo rotula como **Pipeline ponderado**, no como remuneración ganada.

## Períodos compartidos

Se incorpora `/shared/remunerations`, respaldado por el documento revisionado `REMUNERACIONES_V2`.

El documento contiene:

- `rules`;
- `events`;
- `periods`;
- `adjustments`;
- `baseSalaries`;
- `audit`.

Estados de período:

- `draft`;
- `review`;
- `approved`;
- `closed`;
- `paid`;
- `reopened`.

Las escrituras usan CAS y un Durable Object. Un período `closed` o `paid` no puede reescribir silenciosamente eventos ni ajustes. Solo un administrador puede pasarlo explícitamente a `reopened`, conservando el snapshot congelado en esa transición.

## Seguridad y privacidad

- `finance` y `admin` pueden leer/escribir el documento completo;
- `sales` solo puede leer;
- la lectura de `sales` es filtrada en el Worker por su email firmado de Cloudflare Access;
- reglas globales pueden llegar al vendedor, pero eventos, períodos, ajustes y sueldo base de otros vendedores no;
- demo no consulta la fuente compartida;
- las lecturas y exportaciones se registran mediante `Oficina_Auditoria`.

El filtrado visual del navegador deja de ser la única barrera de privacidad.

## Períodos y zona horaria

El motor fija `America/Santiago`.

La semana empresarial comienza el lunes. Los filtros mensuales y anuales se calculan con claves de fecha de Chile en vez de depender de la zona horaria local del navegador.

## Exportación CSV

La exportación:

- incluye BOM UTF-8;
- usa escape RFC 4180;
- neutraliza valores que podrían convertirse en fórmulas de spreadsheet;
- incluye período, vendedor, estado, regla, versión, tasa, base tributaria y fecha de generación;
- usa un nombre de archivo asociado al período;
- registra el evento de exportación en backend.

## Semántica de interfaz

El panel se presenta como **resumen comercial auditable** y declara expresamente que no constituye una liquidación legal de remuneraciones. Se eliminan del motor autoritativo las deducciones previsionales simuladas fijas que podían dar una falsa apariencia de liquidación laboral válida.

## Cobertura

Pruebas obligatorias:

- `tests/remuneraciones-wiring.test.js`;
- `tests/remuneraciones-engine.test.js`;
- `tests/remuneraciones-dias.test.js`;
- `tests/remuneraciones-personas.test.js`;
- integración con Finanzas y smoke global desde `.github/workflows/remuneraciones-audit.yml`.

Los antiguos `test.todo` de los hallazgos críticos fueron convertidos en assertions obligatorias.

## Pendiente externo

La lógica queda lista en repositorio. Igual que las auditorías anteriores, el despliegue productivo del proxy/Cloudflare Access continúa agrupado en el cierre final de #306; hasta ese cutover no debe considerarse validada la identidad productiva del Worker.
