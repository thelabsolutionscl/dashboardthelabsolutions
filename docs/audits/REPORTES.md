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


## Avance 2026-09-29: gasto por mes, historial y estacionalidad

- El gasto de marketing se consulta y edita por `AAAA-MM + canal` al alternar entre Mes cerrado y Mes en curso. La versión antigua sin fecha se migra **únicamente al mes actual**, nunca se replica sobre meses históricos. El gasto sigue siendo local al navegador hasta implementar almacenamiento compartido y auditado.
- El historial visible de reportes se ordena por `Fecha generación` descendente y, si coinciden, por `createdTime` descendente sin reordenar el estado de Airtable.
- El mes calendario en curso ya no participa como observación completa en los promedios ni índices de estacionalidad. Continúa mostrándose como mes futuro/proyectado en los gráficos cuando corresponda.

Pruebas: `tests/reportes-period-history.test.js`. Quedan por resolver las primeras adquisiciones reales del CAC, idempotencia al guardar un reporte semanal y persistencia multiusuario de gastos.

## 2026-09-29 — CAC basado en primera adquisición (#321)

El CAC ahora considera la primera fecha conocida de alta del registro Cliente y la primera cotización histórica. Una cotización de recompra no cuenta como cliente nuevo, aunque sea la primera de ese mes. Si un cliente nuevo cotiza por varios canales durante el mismo período, se atribuye únicamente al canal de su primera cotización, con desempate determinista por ID. Las cotizaciones sin cliente vinculado suman cantidad y revenue aprobado, pero **no se inventan como nuevos clientes**.

La atribución todavía depende de la cobertura y calidad de los registros disponibles en el dashboard: sin historial CRM previo a la migración, el cálculo no puede inferir la adquisición externa anterior. Falta una fuente auditable y compartida para gasto y adquisición entre navegadores.


## 2026-09-29 — Reserva de informe semanal por ISO (PR en curso)

- El formulario usa semana ISO de lunes a domingo, también en los cálculos de indicadores. Antes mezclaba un número de semana diferente con inicio dominical.
- Antes de invocar CEO_AGENT, se verifica la capacidad reportes_iso_upsert en el proxy desplegado y se lee el historial compartido. El automático reutiliza el informe existente sin gastar tokens ni reenviarlo; el manual solicita confirmación antes de reemplazarlo.
- Las altas de Reportes pasan por CRM_MUTATION_GUARD: lectura completa de Airtable, reserva persistente por semana y serialización de dos navegadores. Un reemplazo manual confirmado actualiza con PATCH; un POST incierto se reconcilia leyendo Airtable y, si no aparece, se bloquean nuevos POST.
- El proxy rechaza rutas alternativas de creación y PATCH directo. El formulario falla cerrado si todavía no se ha desplegado la versión protegida del Worker; no activa un flujo nuevo contra un proxy antiguo.
- Los informes antiguos etiquetados como Semana N pueden adoptarse por su fecha de generación cuando solo hay uno. Si hay varios, devuelve REPORTES_LEGACY_DUPLICATES y exige conciliación manual. No se borran filas históricas automáticamente.
- Pruebas: tests/reportes-semana-guard.test.js para carreras, reintentos, fechas y rutas; tests/reportes-client-idempotency.test.js para preflight, costo de IA y reemplazos; reportes-wiring.test.js sin pendientes.
- Despliegue: primero actualizar airtable-proxy con CRM_MUTATION_GUARD y comprobar /health (reportes_iso_upsert=true); después desplegar Pages, revisar dos sesiones y el historial real de Airtable. Sin una prueba externa no declarar certificada la concurrencia de producción.
- Continúa pendiente migrar el gasto de marketing desde localStorage a fuente compartida y reconciliar el historial de adquisiciones antiguo.

## 2026-09-29 — Gastos de marketing compartidos y auditables

- El proxy publica `GET /marketing/spend?month=AAAA-MM`, `PUT /marketing/spend?month=AAAA-MM` y consulta de auditoría `GET /marketing/spend/history?month=AAAA-MM`. Los importes viven en una instancia independiente de Durable Object (el binding existente `CRM_MUTATION_GUARD` con nombre `tls-marketing-spend-global`), separada de la cola de pedidos y facturas; no requiere crear campos de Airtable.
- Lectura y escritura requieren **identidad individual firmada por Cloudflare Access** y rol `finance` o `admin`. La clave global `X-App-Key` sola NO es autorización. Hasta activar Access, el formulario conserva el almacenamiento local anterior pero lo etiqueta como **no sincronizado**; no presenta cifras locales como registros oficiales.
- El servidor guarda cada mes de forma independiente por canal; cada cambio exige `expected_revision`. Si otro equipo escribió entretanto devuelve `409 SPEND_REVISION_CONFLICT`, los datos vigentes y una instrucción para revisar antes de reintentar. Una transacción atómica guarda el nuevo documento y su entrada de auditoría inmutable, con fecha, usuario firmado, canal, importe previo y nuevo.
- El navegador nunca importa silenciosamente importes de otros equipos. Tras conectarse, el registro compartido tiene prioridad; un botón permite importar **solo canales locales que aún no existan**, con confirmación explícita, conservando los datos anteriores en el navegador como respaldo. Si una importación se interrumpe, informa que fue parcial.
- Se muestran canales pagados incluso con **cero cotizaciones**: el gasto existe aunque la captación no. La etiqueta `ROI` del cálculo anterior se corrige a `ROAS` (ingresos atribuidos / gasto), porque no incluye margen, otros costos ni beneficio neto.
- Verificaciones: `tests/reportes-marketing-spend.test.js` prueba escritura concurrente, conflicto de versión, aislamiento de meses, histórico firmado, roles, validación de entrada, sincronización, importación explícita y que el gasto compartido no se duplique en `localStorage`.
- **Activación real pendiente de infraestructura**: configurar y verificar Cloudflare Access, CORS/sesiones, roles de finance/admin y comprobar lectura/escritura con ambos equipos. No probar con dinero real ni declarar fuente compartida activa hasta confirmar que los dos navegadores ven la misma versión y el historial correcto.
- Continúa pendiente reconciliar la fecha de primera adquisición de los clientes registrados antes de la migración del CRM. En ausencia de evidencia, el CAC debe seguir etiquetándose como aproximación basada en el primer evento conocido.

## 2026-09-29 — Verificación de atribución CRM y corrección de origen (PR siguiente)

La lectura autorizada de Airtable detectó **314 Clientes**, **70 Cotizaciones**, **37 Clientes con Fecha primer contacto**, **38 con Origen lead**, **3 con GCLID** y **63 de 70 cotizaciones recibidas por WhatsApp**. Hay al menos **9 clientes cuya cotización conocida precede a la fecha registrada de primer contacto**. Estos son indicadores de cobertura de la muestra leída, no prueba de que otros canales no estén generando ventas.

**Problema demostrado:** «Canal solicitud» describe por dónde se pidió la cotización, no la fuente de captación. La fórmula anterior atribuía esas ventas y clientes a WhatsApp, aunque el lead hubiera llegado por Google Ads. La tabla distinguía gasto por Google Ads de cotizaciones por WhatsApp, creando un denominador engañoso.

**Corrección:**
- Obtener el origen de adquisición de `Clientes.Origen lead`; GCLID o campaña explícita clasifican `Google Ads`. «Google» sin prueba de campaña no se transforma silenciosamente en anuncio pagado.
- «Canal solicitud» queda como desglose operativo independiente; cotizaciones sin fuente CRM conocida van a «Sin atribución», sin adjudicarlas por defecto a WhatsApp.
- Incorporar «Fecha primer contacto» al cálculo de primera adquisición si precede a la primera cotización. Fechas contradictorias no aumentan la cobertura fiable.
- Mostrar porcentajes de cobertura de origen y primera fecha. **Cuando cualquiera es menor al 80%**, ocultar el costo estimado por nuevo cotizante y el ROAS; no presentar cifras de marketing como fiables con una base histórica incompleta.
- Separar el costo por nuevo cotizante del CAC real de clientes pagadores. El revenue por canal aquí son cotizaciones aprobadas netas, no caja cobrada.
- Tests de atribución conocida/ausente, cotizaciones recibidas por WhatsApp, fechas anteriores al alta CRM, primera cotización por varios canales, discrepancias cronológicas y gasto separado por mes.

**Trabajo operativo pendiente**: reconstruir primeras fechas y fuente de captación de los clientes importados, preferiblemente desde evidencias existentes (GCLID/UTM, lead original, correo/WhatsApp con fecha, contrato o primera venta) antes de habilitar de nuevo el indicador. No inventar fechas antiguas ni asignar campañas sin pruebas.


## 2026-09-29 — Cola de revisión de primera adquisición (PR siguiente)

Se verificó otra vez la base operativa de Airtable, exclusivamente en modo lectura: 314 Clientes y 70 Cotizaciones, sin páginas pendientes; 276 Clientes sin `Origen lead`, 277 sin `Fecha primer contacto`, 275 sin ambos campos y 42 con cotizaciones vinculadas. Entre estos últimos, 14 carecen de origen y 9 tienen una fecha de primer contacto posterior a una cotización conocida. Estas cifras son un diagnóstico de cobertura, **no** una autorización para corregir fechas automáticamente ni una medida de adquisiciones reales.

La sección Reportes incorpora una **cola de conciliación de solo lectura** con prioridades (contradicciones de fechas, indicios publicitarios sin origen, cotizantes incompletos y resto del CRM), filtros, acceso al detalle del cliente sujeto a permisos, fecha de cotización más antigua observada y exportación CSV local con protección contra fórmulas de hoja de cálculo. La revisión se calcula directamente sobre el estado CRM cargado, sin escribir nada en Airtable ni copiar listas de clientes al repositorio.

La fecha de la primera cotización se elige desde `Fecha cotización` cuando existe y es válida, o `createdTime` del registro solo como evidencia de menor calidad. No se confunde `createdTime` del Cliente (posible fecha de importación) con su adquisición real. Una fecha de primer contacto posterior a una cotización se **marca**, no se modifica. Las cotizaciones sin vínculo se cuentan por separado. Los operadores deben revisar primero evidencias originales (primer correo/lead, GCLID/UTM, primera cotización o contrato) y corregir individualmente después de contrastarlas.

**Pendiente fuera de código:** configurar Cloudflare Access con identidades/roles individuales para habilitar gasto compartido, validar el flujo completo en dos equipos y completar la conciliación documental de registros antiguos. Mantener activados los avisos de cobertura insuficiente en CAC/ROAS hasta contar con evidencia confiable.


## 2026-09-29 — Editor de conciliación segura (complemento a #326)

- La cola de conciliación ya se encuentra desplegada. En la revisión de su recorrido de corrección se detectó que **Editar Cliente** seleccionaba `Referido` por defecto cuando `Origen lead` estaba vacío. Guardar otros datos podía convertir artificialmente un origen desconocido en referido.
- El editor deja ahora una opción explícita **Sin atribución · por verificar** y no envía `Origen lead` ni `Fecha primer contacto` cuando no se modificaron. La lista conserva los valores actuales de `Origen lead` definidos en Airtable, incluyendo `google_ads`.
- Permite corregir manualmente la primera fecha de contacto con un calendario, solo después de aportar una referencia verificable. No se precompletan fechas usando la cotización ni el día de importación. Un cambio de fecha posterior a una cotización **original fechada** se rechaza hasta contrastar la evidencia; registros creados o migrados sin fecha original no se convierten en fechas de captación.
- Al corregir un origen o fecha, se vuelve a consultar el Cliente en Airtable antes de guardar y se detectan cambios concurrentes en origen, fecha o notas. Las modificaciones documentadas quedan con valor anterior, valor nuevo, fecha y referencia de evidencia en `Notas internas`; no se escriben datos reales durante los tests. Esta prelectura evita sobrescrituras por formularios obsoletos, pero no sustituye una transacción atómica frente a una carrera justo después de consultar.
- La conciliación **no actualiza Clientes en masa**. Las fechas y orígenes de los registros históricos requieren prueba individual. Con baja cobertura siguen ocultos los indicadores de CAC y ROAS que no resultan defendibles.
- Pruebas `tests/reportes-provenance-editor.test.js`: preservar origen desconocido, exigir respaldo, validar fechas, documentar modificaciones, limpiar fuentes falsas de forma explícita, conflictos de dos editores y fallo seguro de consulta.

## 2026-09-29 — Calidad de evidencia cronológica en cola CRM

Una cotización sin `Fecha cotización` utiliza su `createdTime` solo como observación de alta de Airtable. Ese dato **no prueba cuándo se realizó la cotización**: podría ser una importación. La cola distingue visualmente la fecha original de una fecha de alta y exporta el tipo de evidencia en CSV. Los avisos de contradicción cronológica solo se generan frente a una cotización con fecha original explícita; la fecha de alta sin documento original queda visible para revisión, pero no dispara falsos conflictos. Si concurren una fecha de alta anterior y una fecha original posterior, la primera sigue visible como observación más temprana y el conflicto se evalúa contra la fecha original. Se incorporan regresiones para ambos escenarios; no se escriben datos en Airtable.

## 2026-09-29 — Revisión documental dirigida de contradicciones CRM

La comprobación de lectura de Airtable contó **314 Clientes** y **70 Cotizaciones**, sin paginación pendiente: 276 sin origen, 277 sin primera fecha y **9 fechas de contacto posteriores a una cotización con fecha original explícita**. En las 9 fichas afectadas, las notas internas actuales no aportan evidencia suficiente para modificar su fecha; no se corrigieron registros. Las cifras describen el estado observado el 29 de septiembre de 2026, no un histórico inmutable.

La cola de Reportes añade el filtro específico **Contradicciones**, independiente del filtro general Fechas, y muestra la fecha **y el número de la primera cotización original** cuando existe. El CSV exporta ambos datos de manera local con protección contra fórmulas. Las fechas de alta en Airtable siguen identificadas como observaciones de menor calidad y no se usan para inferir el primer contacto. La conciliación de cada uno de los nueve clientes requiere prueba verificable (primer lead/correo/contrato), y el editor ya exige esa referencia.

## 2026-09-29 — Preflight de Access específico para Reportes (sin escrituras)

El workflow manual **Verify Access rollout (read-only)** incorpora el modo `reportes` independiente de SII y del token de servicio del lead-worker. Comprueba que el proxy tiene dominio HTTPS de mismo sitio (`proxy.thelab.solutions`), CORS de navegador para operaciones con credenciales y que **la clave pública compartida por sí sola** recibe `401` al leer el mes de gastos y su historial; ningún test escribe gastos ni solicita modelos de IA. Si el proxy sigue en modo legado, no declara Access activo. Requiere después dos sesiones humanas independientes: `finance` y `admin` deben ver el mismo mes/revisión, mientras `viewer` y `operator` deben quedar denegados. No activar gasto compartido ni declarar completada la validación sin configurar Cloudflare Access y realizar esa prueba con los equipos reales.

## 2026-09-29 — Altas sin fecha de contacto ficticia

Las tres rutas de creación de Cliente (Nuevo lead, flujo guiado y alta rápida desde el cotizador) asignaban hoy al primer contacto aun con clientes históricos. El formulario normal y el guiado aceptan ahora una fecha opcional explícita; una fecha anterior exige referencia verificable de 12–500 caracteres que queda en Notas internas. Fecha inválida o futura bloquea el alta. El alta rápida deja la fecha vacía y el guiado omite Origen lead si el usuario no lo elige. No se modifica ningún registro histórico automáticamente.


## 2026-09-29 — Comprobación del artefacto publicado y CORS adversarial

El preflight manual `reportes` comprueba ahora además el HTML realmente servido por GitHub Pages: debe incluir el filtro «Contradicciones» de Reportes y el primer contacto explícito del CRM. Un despliegue completado con caché antigua, un login HTML en lugar del dashboard o un artefacto incompleto no cuenta como validado. También solicita un preflight `OPTIONS` desde un origen ajeno y rechaza cualquier concesión de CORS con credenciales a ese origen o comodín. Todas las solicitudes son GET u OPTIONS; no se modifican gastos, cotizaciones ni clientes, ni se consumen tokens de IA.

El resumen de GitHub Actions distingue las comprobaciones automáticas de la prueba obligatoria con usuarios reales. Si Cloudflare intercepta las llamadas sin JWT y solo devuelve una redirección/403 del borde, la ejecución de `reportes` se considera inconclusa, no una validación de la seguridad del Worker. Siguen pendientes la configuración de Cloudflare Access y la comprobación con sesiones individuales `finance`/`admin` frente a `viewer`/`operator` en dos navegadores; no activar gasto compartido antes de esa evidencia.

## 2026-09-29 — Smoke público después de desplegar (sin credenciales)

Se añade `Reportes live production smoke (read-only)`, disparado al terminar correctamente `Deploy Dashboard` en main o a mano. Desde un runner independiente comprueba DNS de `dashboard.thelab.solutions` y `proxy.thelab.solutions`, los marcadores publicados de Reportes y del alta explícita del CRM, la versión sellada del service worker comparada con el SHA real del despliegue y el endpoint público `/health` con `marketing_spend_guard=true`. No usa `PROXY_KEY`, JWT, Cloudflare service tokens ni tokens de IA; solo DNS y GET.

El resultado diferencia fallo de DNS, HTML obsoleto, versión incorrecta, Worker de marketing sin binding y una respuesta de Cloudflare que exige revisar una sesión. Un desplegar exitoso en GitHub Pages no se considera certificación de HTTP, DNS ni RBAC. Aunque este smoke pase, la validación firmada `finance/admin` frente a `viewer/operator`, las pruebas entre dos navegadores y el corte seguro de credenciales continúan pendientes hasta configurar Cloudflare Access en la cuenta real. No corregir fechas u orígenes históricos sin evidencia.
