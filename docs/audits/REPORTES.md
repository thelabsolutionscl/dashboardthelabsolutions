# Auditoría de REPORTES

Fecha: 2026-08-02

## Alcance

Se revisó la sección `reporte` y sus vínculos con:

- Airtable `Reportes`;
- `CEO_AGENT` y el contexto vivo del CRM;
- clientes, cotizaciones y pedidos;
- historial y tendencias semanales;
- pronóstico de demanda estacional;
- CAC y ROI por canal;
- reporte automático semanal y correo ejecutivo;
- panel de último reporte en Overview.

## Flujo verificado

1. El dashboard carga hasta 500 registros de `Reportes`.
2. `prefillReporte()` llena las métricas operativas.
3. `crearReporte()` llama al `CEO_AGENT` con contexto real.
4. El resultado se formatea para lectura y conserva el texto crudo.
5. El registro se escribe en Airtable con semana, revenue, conversión, pedidos y resumen.
6. El dashboard recarga la fuente de verdad y vuelve a pintar el historial.
7. `_histSemanas()` ordena y normaliza las últimas semanas para tendencias y correos.
8. `renderEstacionalidad()` usa pedidos no cancelados y venta neta.
9. `renderCacCanal()` usa cotizaciones del mes y revenue neto aprobado.

## Cobertura automática

Archivo:

- `tests/reportes-wiring.test.js`

Workflow:

- `.github/workflows/reportes-audit.yml`

La prueba protege navegación, IDs, funciones únicas, carga de datos, creación del reporte, persistencia, formateo, tendencias, estacionalidad y CAC/ROI.

## Hallazgos pendientes

### 1. “Clientes nuevos” no representa adquisiciones reales

`_canalStats()` cuenta clientes únicos que tuvieron una cotización en el período. Un cliente antiguo que vuelve a cotizar se registra como “nuevo”, por lo que el CAC puede verse artificialmente bajo.

Corrección esperada: determinar la primera fecha conocida del cliente o su primera cotización y contar solo adquisiciones cuyo primer contacto pertenezca al período.

### 2. El gasto de marketing no tiene período

`_gastoCanal()` guarda un monto único por nombre de canal. Al alternar entre “Mes cerrado” y “Mes en curso”, ambos períodos utilizan el mismo gasto.

Corrección esperada: almacenar el gasto con una llave `AAAA-MM + canal`, con migración del formato anterior.

### 3. El historial visible no garantiza orden cronológico

`_histSemanas()` sí ordena por `Fecha generación`, pero `renderReportes()` recorre directamente `state.reportes`. El orden entregado por Airtable no debe asumirse.

Corrección esperada: ordenar una copia por `Fecha generación` descendente y desempatar con `createdTime`.

### 4. Un mismo período puede guardarse más de una vez

El botón manual puede crear varios registros para la misma semana. Los duplicados alteran tendencias, promedios, anomalías y correos.

Corrección esperada: hacer upsert por una llave estable de semana ISO o pedir confirmación para reemplazar el registro existente.

### 5. El mes incompleto sesga la estacionalidad

`_estacionalidad()` incorpora el mes calendario actual como si fuera un mes completo. Durante los primeros días del mes, el índice estacional puede caer artificialmente.

Corrección esperada: excluir el mes actual hasta cerrarlo o prorratearlo explícitamente y marcar la proyección como estimada.

## Criterio de cierre

- CAC cuenta adquisiciones reales.
- El gasto está separado por canal y período.
- Historial visible y analítico comparten el mismo orden determinista.
- Existe un solo reporte por semana ISO.
- El mes incompleto no contamina el índice estacional.
- Los cinco `test.todo` pasan a pruebas activas.
- Workflow `Reportes audit` en verde.
