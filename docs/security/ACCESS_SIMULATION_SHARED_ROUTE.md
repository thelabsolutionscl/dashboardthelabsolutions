# Simulación compartida fuera de Monitor Sistema

El historial agregado del panel sintético usa ahora `GET/PUT /shared/simulation`.
El navegador no necesita leer ni escribir la tabla completa `Monitor Sistema`.

## Autorización

Con Cloudflare Access activo la ruta está disponible solamente para:

- identidades con rol `admin`;
- la identidad exacta `marketing@thelab.solutions`, aunque su rol Access sea
  `viewer`.

No se concede escritura de Simulación al rol `viewer` en general. `operator`,
`finance` y `sales` tampoco heredan esta ruta. El modo Demo del dashboard
permanece local y no toca el historial compartido.

## Documento remoto

El registro Airtable sigue llamándose `SIMULACION`, pero el proxy lo presenta
como un documento versionado:

```json
{
  "version": 1,
  "updatedAt": 0,
  "clearedAt": 0,
  "runs": []
}
```

`runs` conserva como máximo 30 corridas y sólo contiene los agregados que ya
guardaba el módulo; no se persisten los 44 votos crudos.

El registro histórico de producción era un array legado. El servidor lo acepta
y normaliza en lectura sin modificar Airtable. Sólo una escritura posterior lo
convertirá al envelope versionado. Una corrida antigua sin `barrido` también es
válida: ese campo todavía no existía cuando se creó.

## Borrado y concurrencia

`clearedAt` es un tombstone. Una caché local cuyo `ts` sea anterior al último
borrado no puede revivir corridas eliminadas desde otro equipo.

Cada lectura devuelve una revisión SHA-256. Las escrituras pasan por el Durable
Object `tls-shared-simulation`. Si la revisión cambió, el servidor devuelve
409 con el documento vigente. El cliente sólo reintenta ese conflicto confirmado:

- guardado normal: fusiona por ID, respeta `clearedAt`, ordena por `ts` y
  conserva las 30 más nuevas;
- borrado total: es autoritativo y no vuelve a mezclar corridas remotas.

Timeout, redirección o 5xx se consideran resultado incierto y nunca se repiten
a ciegas.

## Compatibilidad verificada

Antes del cambio se inspeccionó `SIMULACION` en Airtable en modo de solo lectura.
Había 2 corridas, 8.554 caracteres y máximo 9 conceptos por corrida. El payload
real pasa el validador nuevo, incluida una corrida histórica anterior al campo
`barrido`. No fue necesaria ninguna escritura ni migración de producción para
preparar esta etapa.
