# Ruta segura de AGENDA bajo Cloudflare Access

AGENDA deja de depender de la lectura/escritura genérica de `Monitor Sistema`.
El navegador usa exclusivamente `GET/PUT /shared/agenda?scope=...`, mientras
el proxy conserva el registro Airtable `Name=AGENDA` como almacenamiento
interno.

## Aislamiento por identidad

- Un usuario firmado con rol `sales` recibe únicamente el alcance cuyo nombre
  coincide exactamente con su email verificado por Cloudflare Access.
- `viewer`, `operator`, `finance` y `admin` reciben sólo
  `__equipo__`.
- `viewer` es sólo lectura. `sales`, `operator`, `finance` y `admin`
  pueden escribir su alcance.
- El JSON completo de AGENDA, otros emails, el `recordId` y los campos Airtable
  nunca se devuelven al navegador.
- El modo legado mantiene un `scope` explícito validado únicamente como
  compatibilidad temporal mientras Cloudflare Access todavía no esté activado.

## Concurrencia e integridad

Cada alcance tiene su propia revisión SHA-256. Los PUT pasan por el Durable
Object `tls-shared-agenda`, que relee Airtable dentro de una cola serializada,
compara la revisión del alcance y sólo reemplaza esa clave del documento. Un
cambio de otro vendedor no produce un falso conflicto y tampoco se pierde.

El cliente reintenta una sola vez únicamente después de un `409
AGENDA_REVISION_CONFLICT` confirmado, fusionando el estado remoto con el local.
Un timeout, 5xx o resultado ambiguo no se reintenta a ciegas.

El esquema acepta los compromisos históricos que aún no tienen `mts` o
`del`, pero rechaza campos desconocidos, scopes no autorizados, tipos
incorrectos y documentos fuera de los límites establecidos. El cargador
genérico de `Monitor Sistema` filtra AGENDA antes de hidratar el frontend para
evitar una dependencia lateral de la ruta antigua.
